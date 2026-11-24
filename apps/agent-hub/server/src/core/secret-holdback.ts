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
 * 单段无空白文本超过 MAX_HOLD_CHARS 时才在离末尾 HOLDBACK_CHARS 处强行切，强切点同样经过 2、5 两步，
 * 所以已经成形的密钥不会被切开（审查 6041423500 第 1 条）。只有超过 MAX_HOLD_CHARS 的未闭合 PEM 块会被切开，
 * 那不可能是真实私钥（见 security.md §8）。
 *
 * 所有放出路径都只能走 splitForRedaction（审查 6042585463）：continue / force / end / truncate
 * 四种模式都在这里做脱敏匹配与切点保护，EventStore 不得另起一条放行。
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

/** 整段文字本身就是一条脱敏规则的匹配（force 切不出安全前段时可以整段放出）。 */
function wholeIsCompleteMatch(text: string): boolean {
  for (const { re } of REDACT_RULES) {
    for (const m of text.matchAll(re)) {
      if (m.index === 0 && m[0].length === text.length) return true;
    }
  }
  return false;
}

/**
 * 所有放出路径的唯一入口：把 text 分成现在可以下发的 emit 和需要扣住（或丢掉）的 hold。
 * emit + hold === text。
 *
 * - continue：正常增量，扣住短尾。
 * - force：任务扣留超过总上限，必须尽量放出前段；用强切，短尾继续扣着。切不出安全前段时整段
 *   继续扣；若整段就是一个匹配，整段放出（调用方把这一路标记成「后续文字前面拼上旧尾巴再切」）。
 * - end：这一路已结束，整段放出。
 * - truncate：1 MB 截断。cutLimit 是拟截到的位置（字符下标）。先把截断点前那段连续非空白退到
 *   最后一个空白之后（长度上限 MAX_HOLD_CHARS），再走 guardCut。hold 是要丢弃的后缀，不得再下发。
 */
export function splitForRedaction(
  text: string,
  mode: ReleaseMode | boolean = 'continue',
  cutLimit?: number,
): { emit: string; hold: string } {
  const kind = normalizeMode(mode);
  if (kind === 'end') return { emit: text, hold: '' };

  let cut = kind === 'truncate' ? (cutLimit ?? text.length) : text.length - HOLDBACK_CHARS;
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
  // truncate / force：只回看 MAX_HOLD_CHARS；窗口内没有空白就保住切点（强切）。
  if (cut > 0 && !WS.test(text[cut - 1]!)) {
    let j = cut - 1;
    const floor = kind === 'continue' ? 0 : Math.max(0, cut - MAX_HOLD_CHARS);
    while (j >= floor && !WS.test(text[j]!)) j--;
    if (j >= floor && j >= 0 && WS.test(text[j]!)) cut = j + 1;
    else if (kind === 'continue' && j < 0 && text.length <= MAX_HOLD_CHARS) cut = 0;
  }

  cut = guardCut(text, cut);

  // 强行切时别切开代理对。
  if (cut > 0 && /[\uD800-\uDBFF]/.test(text[cut - 1]!)) cut--;

  if (cut <= 0) {
    if (kind === 'force' && wholeIsCompleteMatch(text)) return { emit: text, hold: '' };
    return { emit: '', hold: text };
  }
  return { emit: text.slice(0, cut), hold: text.slice(cut) };
}
