const MASK = '«已脱敏»';

/** §5 的全部模式。替换成固定占位，重复调用结果不变。 */
export function redact(text: string): string {
  let out = text;
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    MASK,
  );
  out = out.replace(/\b(?:ahu|ahb)_[A-Za-z0-9_-]{43}\b/g, MASK);
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, MASK);
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, MASK);
  out = out.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, MASK);
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, MASK);
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, MASK);
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MASK);
  out = out.replace(/\b(https?:\/\/)[^/\s@]+@/gi, '$1');
  out = out.replace(/\b(ssh:\/\/)([^:/\s@]+):[^@/\s]+@/gi, '$1$2@');
  out = out.replace(/((?:authorization|x-access-token)\s*[:=]\s*)(?:bearer\s+)?\S+/gi, `$1${MASK}`);
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
