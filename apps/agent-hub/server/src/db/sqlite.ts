import { chmodSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParams = Record<string, SqlValue>;

/**
 * node:sqlite 的唯一入口。业务代码只用 run / get / all / tx，不直接接触 DatabaseSync。
 * SQL 里一律用 :name 命名参数；params 的键不带冒号；值只能是 SqlValue。
 */
export class Db {
  private readonly conn: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private inTx = false;

  constructor(readonly file: string) {
    this.conn = new DatabaseSync(file);
    this.conn.exec('PRAGMA journal_mode = WAL');
    this.conn.exec('PRAGMA synchronous = NORMAL');
    this.conn.exec('PRAGMA foreign_keys = ON');
    this.conn.exec('PRAGMA busy_timeout = 5000');
    try {
      chmodSync(file, 0o600);
    } catch {
      // ignore chmod failures on exotic fs
    }
  }

  exec(sql: string): void {
    this.conn.exec(sql);
  }

  /** 返回受影响的行数。 */
  run(sql: string, params: SqlParams = {}): number {
    return Number(this.prepare(sql).run(params).changes);
  }

  get<T>(sql: string, params: SqlParams = {}): T | undefined {
    return this.prepare(sql).get(params) as T | undefined;
  }

  all<T>(sql: string, params: SqlParams = {}): T[] {
    return this.prepare(sql).all(params) as T[];
  }

  /** 同步事务。回调里不能 await；嵌套调用并入外层事务。 */
  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.conn.exec('BEGIN IMMEDIATE');
    this.inTx = true;
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('Db.tx 的回调必须是同步函数');
      this.conn.exec('COMMIT');
      return result;
    } catch (err) {
      this.conn.exec('ROLLBACK');
      throw err;
    } finally {
      this.inTx = false;
    }
  }

  close(): void {
    this.statements.clear();
    this.conn.close();
  }

  private prepare(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.conn.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }
}

export const toBool = (v: number): boolean => v === 1;
export const fromBool = (v: boolean): number => (v ? 1 : 0);
export const toJson = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));
export const fromJson = <T>(v: string | null): T | null =>
  v == null ? null : (JSON.parse(v) as T);
