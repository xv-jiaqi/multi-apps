const MASK = '«已脱敏»';

/**
 * §5 的全部模式，按顺序替换。替换结果不再匹配这些模式，重复调用结果不变。
 * secret-holdback.ts 用同一张表找“切点不能落进去”的区间。
 */
export const REDACT_RULES: ReadonlyArray<{ re: RegExp; to: string }> = [
  // 私钥块：到 END 行为止；没闭合（head -c 400 id_rsa、输出被截断）就一直打码到文末。
  {
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    to: MASK,
  },
  // 令牌开头不要求 \b：紧贴字母数字（abcghp_…、xxxeyJ…）也打码。在 6.5 亿字符的依赖源码里统计过，
  // 去掉 \b 后这几条多出的匹配是 0（security.md §8）。
  { re: /(?:ahu|ahb)_[A-Za-z0-9_-]{43}\b/g, to: MASK },
  { re: /github_pat_[A-Za-z0-9_]{20,}\b/g, to: MASK },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}\b/g, to: MASK },
  // sk- 例外：去掉 \b 会误伤 task-list-item-… 这类普通单词（同一语料里 119 处），所以只额外放过
  // URL 编码之后的位置（key%3Dsk-…）。紧贴字母数字的 abcsk-… 仍不打码，见 §8 已知缺口。
  { re: /(?:\b|(?<=%[0-9A-Fa-f]{2}))sk-[A-Za-z0-9_-]{20,}\b/g, to: MASK },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}\b/g, to: MASK },
  { re: /AKIA[0-9A-Z]{16}\b/g, to: MASK },
  { re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, to: MASK },
  // URL 凭据不要求词边界：xhttps://u:p@h 这种紧贴字母数字的也要打码。
  { re: /(https?:\/\/)[^/\s@]+@/gi, to: '$1' },
  { re: /(ssh:\/\/)([^:/\s@]+):[^@/\s]+@/gi, to: '$1$2@' },
  // 认证头：scheme（Bearer / Basic / Token）和后面的凭据一起打码；`curl -v -u` 输出的是 Basic。
  {
    re: /((?:authorization|x-access-token)\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?\S+/gi,
    to: `$1${MASK}`,
  },
];

export function redact(text: string): string {
  let out = text;
  for (const { re, to } of REDACT_RULES) out = out.replace(re, to);
  return out;
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}
