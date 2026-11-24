import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { findPrincipal } from '../auth/principal';
import { redact } from '../common/redact';

/** 对 JSON 值里的每个字符串（不含键名）应用 fn。 */
export function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = mapStrings(v, fn);
    return out;
  }
  return value;
}

/** 全局拦截器：响应给桥接 token 的内容统一脱敏（redact 是幂等的，重复执行无害）。 */
@Injectable()
export class BridgeRedactInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = findPrincipal(context.switchToHttp().getRequest<Request>());
    if (principal?.kind !== 'bridge') return next.handle();
    return next.handle().pipe(map((body: unknown) => mapStrings(body, redact)));
  }
}

/**
 * 按文件边界截断补丁，使 UTF-8 字节数不超过 maxBytes。
 * 第一个文件就超限时返回空串；没有超限时原样返回。
 */
export function truncatePatch(
  patch: string,
  maxBytes: number,
): { patch: string; truncated: boolean } {
  if (Buffer.byteLength(patch, 'utf8') <= maxBytes) return { patch, truncated: false };
  const starts: number[] = [];
  const header = /^diff --git /gm;
  for (let m = header.exec(patch); m; m = header.exec(patch)) starts.push(m.index);
  if (starts[0] !== 0) starts.unshift(0);
  starts.push(patch.length);
  let used = 0;
  let end = 0;
  for (let i = 0; i + 1 < starts.length; i++) {
    const size = Buffer.byteLength(patch.slice(starts[i], starts[i + 1]), 'utf8');
    if (used + size > maxBytes) break;
    used += size;
    end = starts[i + 1]!;
  }
  return { patch: patch.slice(0, end), truncated: true };
}
