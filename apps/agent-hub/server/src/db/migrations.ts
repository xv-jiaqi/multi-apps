// server/src/db/migrations.ts
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { MIGRATION_1 } from './schema';
import type { Db } from './sqlite';

/** 只追加，不修改已发布的条目。下标 i 的迁移把 user_version 从 i 升到 i + 1。 */
export const MIGRATIONS: readonly string[] = [MIGRATION_1];

export class MigrationError extends Error {}

export function migrate(db: Db): { from: number; to: number } {
  const from = db.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
  const to = MIGRATIONS.length;
  if (from > to) {
    throw new MigrationError(`数据库版本 ${from} 比程序支持的 ${to} 新，请更新 Agent Hub`);
  }
  if (from === to) return { from, to };
  if (from > 0) backup(db, from);
  for (let v = from; v < to; v++) {
    try {
      db.tx(() => {
        db.exec(MIGRATIONS[v]!);
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } catch (err) {
      throw new MigrationError(`迁移到版本 ${v + 1} 失败：${(err as Error).message}`);
    }
  }
  return { from, to };
}

/** VACUUM INTO 在 WAL 模式下也能得到一致的副本；只保留最近 3 份。 */
function backup(db: Db, fromVersion: number): void {
  const dir = dirname(db.file);
  const name = basename(db.file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `${name}.bak-${stamp}-v${fromVersion}`);
  if (existsSync(target)) rmSync(target);
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  const old = readdirSync(dir)
    .filter((f) => f.startsWith(`${name}.bak-`))
    .sort()
    .reverse()
    .slice(3);
  for (const f of old) rmSync(join(dir, f));
}
