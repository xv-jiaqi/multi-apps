const MASK = '«已脱敏»';

/**
 * §5 的全部模式，按顺序替换。替换结果不再匹配这些模式，重复调用结果不变。
 * secret-holdback.ts 用同一张表找“切点不能落进去”的区间。
 */
export const REDACT_RULES: ReadonlyArray<{ re: RegExp; to: string }> = [
  {
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    to: MASK,
  },
  { re: /\b(?:ahu|ahb)_[A-Za-z0-9_-]{43}\b/g, to: MASK },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, to: MASK },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, to: MASK },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, to: MASK },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, to: MASK },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: MASK },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, to: MASK },
  { re: /\b(https?:\/\/)[^/\s@]+@/gi, to: '$1' },
  { re: /\b(ssh:\/\/)([^:/\s@]+):[^@/\s]+@/gi, to: '$1$2@' },
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
