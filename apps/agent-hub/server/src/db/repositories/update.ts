import type { SqlParams, SqlValue } from '../sqlite';

/** patch 的键是列名；值为 undefined 的键跳过，null 写 NULL。没有可写的列时返回 0。 */
export function updateById(
  run: (sql: string, params: SqlParams) => number,
  table: 'tasks' | 'turns',
  id: string,
  patch: Record<string, SqlValue | undefined>,
): number {
  const sets: string[] = [];
  const params: SqlParams = { id };
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${column} = :${column}`);
    params[column] = value;
  }
  if (sets.length === 0) return 0;
  return run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = :id`, params);
}
