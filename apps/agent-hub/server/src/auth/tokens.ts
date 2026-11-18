// server/src/auth/tokens.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const UI_TOKEN_PREFIX = 'ahu_';
export const BRIDGE_TOKEN_PREFIX = 'ahb_';

/** 前缀 + 32 字节随机数的 base64url，共 47 个字符。 */
export function generateToken(prefix: typeof UI_TOKEN_PREFIX | typeof BRIDGE_TOKEN_PREFIX): string {
  return prefix + randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 界面上用来辨认 token 的前 12 个字符，例如 "ahb_3kF9xQ2a"。 */
export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, 12);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseBearer(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{8,200})$/.exec(header ?? '');
  return match ? match[1]! : null;
}
