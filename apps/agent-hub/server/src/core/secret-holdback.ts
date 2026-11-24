/**
 * 增量输出的“尾部扣留”（审查 6040751657）：EventStore 落库增量事件时，每一路输出（task + 事件类型 + itemId）
 * 把末尾可能还没写完的密钥扣住，和下一块拼起来再决定切点，保证任何一个密钥都完整落在同一条增量事件里。
 * 这样对单条事件做 redact()（桥接 REST 拦截器、WS 发送）就不会漏掉被切开的密钥；Hub UI 拿到的仍是原文，
 * 只是增量的切法变了，拼起来与原来逐字相同。
 *
 * 切点只落在 redact.ts 的任何模式都不可能跨越的位置：
 * 1. 空白字符之后：除下面两种外，redact.ts §5 的模式都不含空白（token、URL userinfo）。
 * 2. 不在“Authorization: Bearer ”这类前缀之后：这个模式本身含空白，前缀和 token 必须在同一块。
 * 3. 不在 PEM 块里（BEGIN 到 END 行之间，或 END 还没来）：BEGIN…END 跨多行，整块要在同一块里。
 * 4. 离末尾至少 HOLDBACK_CHARS 个字符：见下面常量的依据。
 * 只有在单段无空白文本或未闭合 PEM 超过 MAX_HOLD_CHARS 时才强行切（残余风险，见 security.md §8）。
 */

/**
 * redact.ts 里各模式最短匹配的长度，取最大值作为扣留窗口的下限：
 * ahu_/ahb_ token 4+43=47；github_pat_ 11+20=31；JWT 3+8+1+8+1+8=29；gh?_ 4+20=24；
 * sk- 3+20=23；"x-access-token: bearer " 23；AKIA 4+16=20；xox?- 5+10=15。
 * 最长 47，取 64（2 的幂、留出余量）。末尾 64 个字符内开始的任何密钥都不会被提前下发。
 */
export const HOLDBACK_CHARS = 64;

/** 单段无空白文本 / 未闭合 PEM 最多扣这么多；4096 位 RSA 的 PEM 约 3.3 KB，最长的 JWT 也远小于此。 */
export const MAX_HOLD_CHARS = 64 * 1024;

/** “-----BEGIN”本身不含空白，不会被切开；只要后面还没有完整的 END 行，就算没闭合（END 行写了一半也算）。 */
const PEM_BEGIN = /-----BEGIN/g;
const PEM_END = /-----END [A-Z0-9 ]*-----/;
/** redact.ts 中含空白的头部模式的前缀：切点不能紧跟在它后面。 */
const HEADER_PREFIX = /(?:authorization|x-access-token)\s*(?:[:=]\s*(?:bearer\s*)?)?$/i;
const WS = /\s/;

/**
 * 把 text 分成现在可以下发的 emit 和需要扣住的 hold（emit + hold === text）。
 * final=true（这一路输出结束）时全部下发。
 */
export function splitForRedaction(text: string, final = false): { emit: string; hold: string } {
  if (final) return { emit: text, hold: '' };
  let cut = text.length - HOLDBACK_CHARS;
  if (cut <= 0) return { emit: '', hold: text };

  // 3. PEM 块不能被切开：切点落在 BEGIN 与 END 行之间（或 END 还没来）就退到 BEGIN 前。
  for (const m of text.matchAll(PEM_BEGIN)) {
    if (m.index >= cut) break;
    const after = m.index + m[0].length;
    const end = PEM_END.exec(text.slice(after));
    const blockEnd = end ? after + end.index + end[0].length : Infinity;
    if (cut >= blockEnd) continue;
    if (end || text.length - m.index <= MAX_HOLD_CHARS) cut = m.index;
    break;
  }

  // 1. 退到空白之后（不切在一段 token 中间）。
  if (cut > 0 && !WS.test(text[cut - 1]!)) {
    let j = cut - 1;
    while (j >= 0 && !WS.test(text[j]!)) j--;
    if (j >= 0) cut = j + 1;
    else if (text.length <= MAX_HOLD_CHARS) cut = 0;
  }

  // 2. 不切在 Authorization / x-access-token 前缀之后。
  const header = HEADER_PREFIX.exec(text.slice(Math.max(0, cut - 256), cut));
  if (header && header[0].length > 0) cut -= header[0].length;

  // 强行切时别切开代理对。
  if (cut > 0 && /[\uD800-\uDBFF]/.test(text[cut - 1]!)) cut--;
  return { emit: text.slice(0, cut), hold: text.slice(cut) };
}
