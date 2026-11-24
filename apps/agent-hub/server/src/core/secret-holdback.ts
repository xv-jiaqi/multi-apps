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
 * 5. 不落在 redact.ts 任何一条规则在整段文字上的匹配里（REDACT_RULES）：落进去就退到匹配开头。
 * 按上面的规则要扣住的尾巴超过 MAX_HOLD_CHARS 时（例如超过 64 KiB 的无空白长行），才在离末尾
 * HOLDBACK_CHARS 处强行切，而且强切点还要退到任何“还没写完的密钥”的开头之前（openSecretStart），
 * 再经过 2、5 两步。这样已经成形的密钥、以及跨过末尾还没写完的密钥都不会被切开（审查 6041423500 第 1 条、
 * 6042967785 第 6 条）。强切之后要扣的尾巴仍超过 MAX_HOLD_CHARS（一个超长的未闭合 PEM 块，或一个
 * 超过 64 KiB 还没写完的“密钥”），返回 seal，调用方整路丢弃，绝不在里面切。
 *
 * 所有放出路径都只能走 splitForRedaction（审查 6042585463）：continue / force / end / truncate
 * 四种模式都在这里做脱敏匹配与切点保护，EventStore 不得另起一条放行。force 与 continue 同一规则，
 * truncate 回看空白不设下限（审查 6042967785）。
 */

import { REDACT_RULES } from '../common/redact';

/**
 * redact.ts 里各模式最短匹配的长度，取最大值作为扣留窗口的下限：
 * ahu_/ahb_ token 4+43=47；github_pat_ 11+20=31；JWT 3+8+1+8+1+8=29；gh?_ 4+20=24；
 * sk- 3+20=23；AKIA 4+16=20；xox?- 5+10=15。认证头的前缀另有第 2 步保护，不占窗口。
 * 最长 47，取 64（2 的幂、留出余量）。末尾 64 个字符内开始的任何密钥都不会被提前下发。
 */
export const HOLDBACK_CHARS = 64;

/** 单段无空白文本 / 未闭合 PEM 最多扣这么多；4096 位 RSA 的 PEM 约 3.3 KB，最长的 JWT 也远小于此。 */
export const MAX_HOLD_CHARS = 64 * 1024;

/** “-----BEGIN”本身不含空白，不会被切开；只要后面还没有完整的 END 行，就算没闭合（END 行写了一半也算）。 */
const PEM_BEGIN = /-----BEGIN/g;
const PEM_END = /-----END [A-Z0-9 ]*-----/;
const WS = /\s/;
const HEADER_NAME = /(?:authorization|x-access-token)$/i;
const SCHEME = /(?:^|\s)(?:bearer|basic|token)$/i;

/**
 * 每条 REDACT_RULES 的“还没写完”版本：一个完整匹配的任何前缀（够长的）都会被对应的模式匹配到、且一直
 * 延伸到末尾。只放宽不收紧（字符集、长度都更宽，也不要求词边界），所以漏判不会发生，只会多扣。
 * 私钥块由 openPemStart 处理（没有 END 的 BEGIN 都算没写完）。
 * 证明见 openSecretStart。
 */
const OPEN_SECRET: readonly RegExp[] = [
  /\b(?:ahu|ahb)_[A-Za-z0-9_-]*$/,
  /\bgithub_pat_[A-Za-z0-9_]*$/,
  /\bgh[pousr]_[A-Za-z0-9]*$/,
  /\bsk-[A-Za-z0-9_-]*$/,
  /\bxox[baprs]-[A-Za-z0-9-]*$/,
  /\bAKIA[0-9A-Z]*$/,
  /\beyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}$/,
  /https?:\/\/[^/\s@]*$/i,
  /ssh:\/\/[^:/\s@]*(?::[^@/\s]*)?$/i,
  /(?:authorization|x-access-token)\s*(?:[:=]\s*(?:(?:bearer|basic|token)(?:\s+\S*)?|\S*)?)?$/i,
];

/**
 * 最左边一个“可能还没写完的密钥”的开头；没有就返回 text.length。
 *
 * 为什么强切点 ≤ 它就安全：设最终全文里某个匹配 m 跨过切点 c（m.start < c < m.end），c ≤ len − 64。
 * - m.end ≤ len：m 在当前文字里已经成形，guardCut 的规则 5 会把 c 退到 m.start。
 * - m.end > len：text.slice(m.start) 是 m 的前缀，长度 > 64，已经含有 m 的整个字面前缀（最长 14 个字符），
 *   所以被上面对应的 OPEN_SECRET 模式在 m.start（或更左）处匹配到末尾，openSecretStart ≤ m.start < c，矛盾。
 */
export function openSecretStart(text: string): number {
  let start = openPemStart(text);
  for (const re of OPEN_SECRET) {
    const m = re.exec(text);
    if (m && m.index < start) start = m.index;
  }
  return start;
}

/**
 * emit 是否以认证头的前缀结尾（`Authorization`、`Authorization:`、`Authorization:   Basic   ` 等，空白多长都算）。
 * 是的话返回前缀开头的位置。逐段 trimEnd，不用回看窗口（审查 6041423500 第 5 条）。
 */
function headerPrefixStart(emit: string): number {
  const name = (s: string) => {
    const tail = s.slice(-14);
    const m = HEADER_NAME.exec(tail);
    return m ? s.length - tail.length + m.index : -1;
  };
  let e = emit.trimEnd();
  const direct = name(e);
  if (direct >= 0) return direct;
  const scheme = SCHEME.exec(e.slice(-7));
  if (scheme) e = e.slice(0, e.length - scheme[0].trimStart().length).trimEnd();
  if (!/[:=]$/.test(e)) return -1;
  return name(e.slice(0, -1).trimEnd());
}

/** 把切点移出 redact 规则在整段文字上的任何匹配（匹配之间可能嵌套，所以重复到不再变）。 */
function outOfMatches(text: string, cut: number): number {
  for (let moved = true; moved && cut > 0; ) {
    moved = false;
    for (const { re } of REDACT_RULES) {
      for (const m of text.matchAll(re)) {
        if (m.index >= cut) break;
        if (m.index + m[0].length > cut) {
          cut = m.index;
          moved = true;
          break;
        }
      }
    }
  }
  return cut;
}

/**
 * 规则 2 和 5 交替做到不再移动：认证头前缀之后不切；切点不落在任何脱敏匹配里。
 * text 要包含切点之后的文字（匹配是在整段上找的）；返回值 ≤ cut。
 */
export function guardCut(text: string, cut: number): number {
  for (let prev = -1; prev !== cut && cut > 0; ) {
    prev = cut;
    const header = headerPrefixStart(text.slice(0, cut));
    if (header >= 0) cut = header;
    cut = outOfMatches(text, cut);
  }
  return Math.max(cut, 0);
}

/** EventStore 放出增量时的模式；布尔值是旧写法（true = end，false = continue）。 */
export type ReleaseMode = 'continue' | 'force' | 'end' | 'truncate';

function normalizeMode(mode: ReleaseMode | boolean): ReleaseMode {
  if (mode === true || mode === 'end') return 'end';
  if (mode === false || mode === 'continue') return 'continue';
  return mode;
}

/** splitForRedaction 的结果：emit + hold === text。seal = 这一路必须整路丢弃（hold 不得落库）。 */
export interface Split {
  emit: string;
  hold: string;
  seal?: true;
}

/**
 * 所有放出路径的唯一入口：把 text 分成现在可以下发的 emit 和剩下的 hold。
 *
 * - continue：正常增量，扣住短尾（上面的规则 1–5）。要扣的尾巴超过 MAX_HOLD_CHARS 时强切，
 *   强切点 ≤ openSecretStart；强切后仍超过就 seal。
 * - force：任务扣留超过总上限时用，规则与 continue 完全相同（审查 6042967785）。
 * - end：这一路已结束，整段放出。
 * - truncate：1 MB 截断。cutLimit 是拟截到的位置；hold 是要丢弃的后缀。往回找空白没有下限，整段都没有
 *   空白就整段丢掉（emit=''）；没闭合的 PEM 块一律退到 BEGIN 前。
 */
export function splitForRedaction(
  text: string,
  mode: ReleaseMode | boolean = 'continue',
  cutLimit?: number,
): Split {
  const kind = normalizeMode(mode);
  if (kind === 'end') return { emit: text, hold: '' };
  const truncate = kind === 'truncate';

  const limit = truncate
    ? Math.min(cutLimit ?? text.length, text.length)
    : text.length - HOLDBACK_CHARS;
  if (limit <= 0) return { emit: '', hold: text };
  let cut = limit;

  // 3. PEM 块不能被切开：切点落在 BEGIN 与 END 行之间（或 END 还没来）就退到 BEGIN 前。
  for (const m of text.matchAll(PEM_BEGIN)) {
    if (m.index >= cut) break;
    const after = m.index + m[0].length;
    const end = PEM_END.exec(text.slice(after));
    const blockEnd = end ? after + end.index + end[0].length : Infinity;
    if (cut >= blockEnd) continue;
    cut = m.index;
    break;
  }

  // 1. 退到空白之后（不切在一段 token 中间）；没有空白就是 0。
  if (cut > 0 && !WS.test(text[cut - 1]!)) {
    let j = cut - 1;
    while (j >= 0 && !WS.test(text[j]!)) j--;
    cut = j + 1;
  }

  // 要扣的尾巴太长（continue / force）：强切，但不越过任何还没写完的密钥（含没闭合的私钥块）的开头。
  if (!truncate && text.length - cut > MAX_HOLD_CHARS) {
    cut = Math.max(cut, Math.min(limit, openSecretStart(text)));
  }

  cut = guardCut(text, cut);

  // 强行切时别切开代理对。
  if (cut > 0 && /[\uD800-\uDBFF]/.test(text[cut - 1]!)) cut--;

  const emit = cut > 0 ? text.slice(0, cut) : '';
  const hold = text.slice(emit.length);
  if (!truncate && hold.length > MAX_HOLD_CHARS) return { emit, hold, seal: true };
  return { emit, hold };
}

/** 第一个还没闭合的 PEM 块（BEGIN 之后没有完整的 END 行）的开头；没有就返回 text.length。 */
function openPemStart(text: string): number {
  for (const m of text.matchAll(PEM_BEGIN)) {
    const after = m.index + m[0].length;
    if (!PEM_END.test(text.slice(after))) return m.index;
  }
  return text.length;
}
