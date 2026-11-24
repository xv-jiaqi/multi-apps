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
const PEM_END_AT = /-----END [A-Z0-9 ]*-----/y;
const WS = /\s/;
const HEADER_NAME = /(?:authorization|x-access-token)$/i;
const SCHEME = /(?:^|\s)(?:bearer|basic|token)$/i;

/**
 * 每条令牌规则的“还没写完”版本：字面前缀 + 末尾一段属于该规则字符集的字符（不限长度、不要求词边界）。
 * 一个完整匹配的任何前缀（够长的）都落在这个形状里，所以只会多扣、不会漏判。
 * 不用 `/…[class]*$/` 这种正则直接在长文本上找：没有锚点的 `*$` 在一段很长、又反复出现前缀的文字上会
 * 退化成平方级。这里先从末尾往前找出这段字符集的连续区间，再在区间里找最左边的字面前缀，线性时间。
 */
interface OpenToken {
  /** 字面前缀。 */
  lit: RegExp;
  /** 前缀之后允许的字符。 */
  cls: RegExp;
  /** 前缀本身的字符也都在 cls 里（ghp_ 的 “_” 不在，单独处理）。 */
  litInClass: boolean;
  /** JWT：区间里最多再出现两个点。 */
  maxDots?: number;
}
const OPEN_TOKENS: readonly OpenToken[] = [
  { lit: /(?:ahu|ahb)_/, cls: /[A-Za-z0-9_-]/, litInClass: true },
  { lit: /github_pat_/, cls: /[A-Za-z0-9_]/, litInClass: true },
  { lit: /gh[pousr]_$/, cls: /[A-Za-z0-9]/, litInClass: false },
  { lit: /sk-/, cls: /[A-Za-z0-9_-]/, litInClass: true },
  { lit: /xox[baprs]-/, cls: /[A-Za-z0-9-]/, litInClass: true },
  { lit: /AKIA/, cls: /[0-9A-Z]/, litInClass: true },
  { lit: /eyJ/, cls: /[A-Za-z0-9_.-]/, litInClass: true, maxDots: 2 },
];

/** URL / ssh 的“还没写完”版本。`[^/\s@]*` 遇到下一个 “//” 就停，不会退化。 */
const OPEN_URL: readonly RegExp[] = [/https?:\/\/[^/\s@]*$/i, /ssh:\/\/[^:/\s@]*(?::[^@/\s]*)?$/i];

/** 末尾那段连续属于 cls 的字符的开头（maxDots：从末尾数，遇到第 maxDots+1 个点就停在它后面）。 */
function trailingRun(text: string, cls: RegExp, maxDots = Infinity): number {
  let i = text.length;
  let dots = 0;
  while (i > 0 && cls.test(text[i - 1]!)) {
    if (text[i - 1] === '.' && ++dots > maxDots) break;
    i--;
  }
  return i;
}

function openTokenStart(text: string, tok: OpenToken): number {
  const run = trailingRun(text, tok.cls, tok.maxDots);
  if (!tok.litInClass) {
    // 前缀里有不在 cls 里的字符：前缀只能正好结束在区间开头。
    const head = text.slice(Math.max(0, run - 4), run);
    return tok.lit.test(head) ? run - 4 : -1;
  }
  const i = text.slice(run).search(tok.lit);
  return i < 0 ? -1 : run + i;
}

/**
 * 最左边一个“可能还没写完的密钥”的开头；没有就返回 text.length。
 *
 * 为什么强切点 ≤ 它就安全：设最终全文里某个匹配 m 跨过切点 c（m.start < c < m.end），c ≤ len − 64。
 * - m.end ≤ len：m 在当前文字里已经成形，guardCut 的规则 5 会把 c 退到 m.start。
 * - m.end > len：text.slice(m.start) 是 m 的前缀，长度 > 64，已经含有 m 的整个字面前缀（最长 14 个字符）。
 *   令牌、URL：落在上面对应的“未写完”形状里，开头 ≤ m.start。私钥块：BEGIN 之后还没有 END，openPemStart ≤ m.start。
 *   认证头：值已经写出至少一个字符时，当前文字里已经有同一开头的完整匹配（\S+ 一直到末尾），归第一种情况；
 *   值还没写出来时，末尾就是认证头前缀（关键字、冒号、scheme 之间空白多长都算），headerPrefixStart 找得到。
 *   所以 openSecretStart ≤ m.start < c，矛盾。
 * 整个函数是线性时间（审查 #315 之后的自查：原来的 `…\S*$` 正则在一行重复的 “authorization:” 上要跑几分钟）。
 */
export function openSecretStart(text: string): number {
  let start = openPemStart(text);
  for (const tok of OPEN_TOKENS) {
    const i = openTokenStart(text, tok);
    if (i >= 0 && i < start) start = i;
  }
  for (const re of OPEN_URL) {
    const m = re.exec(text);
    if (m && m.index < start) start = m.index;
  }
  const header = headerPrefixStart(text);
  if (header >= 0 && header < start) start = header;
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
  // 线性：先找最后一个完整的 END 行，再找它之后（BEGIN 的结尾在它开头之后）的第一个 BEGIN。
  let lastEnd = -1;
  for (let i = text.lastIndexOf('-----END '); i >= 0; i = text.lastIndexOf('-----END ', i - 1)) {
    PEM_END_AT.lastIndex = i;
    if (PEM_END_AT.test(text)) {
      lastEnd = i;
      break;
    }
    if (i === 0) break;
  }
  const begin = text.indexOf('-----BEGIN', Math.max(0, lastEnd - '-----BEGIN'.length + 1));
  return begin < 0 ? text.length : begin;
}
