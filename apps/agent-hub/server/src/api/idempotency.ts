import { createHash } from 'node:crypto';

/** 键排序后的 JSON，用来判断“同样的请求体”。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const fields = Object.keys(obj)
      .sort()
      .filter((key) => obj[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** routeKey：`/tasks` 或 `/tasks/<完整任务 id>/turns`（短号先解析成完整 id）。 */
export function requestHash(method: string, routeKey: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${routeKey}\n${canonicalJson(body ?? {})}`, 'utf8')
    .digest('hex');
}
