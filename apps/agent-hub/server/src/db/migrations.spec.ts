import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, MigrationError, MIGRATIONS } from './migrations';
import { Db } from './sqlite';

function tmpDb(): { dir: string; db: Db } {
  const dir = mkdtempSync(join(tmpdir(), 'ah-mig-'));
  const db = new Db(join(dir, 'hub.db'));
  return { dir, db };
}

describe('migrations', () => {
  afterEach(() => {
    // cleaned per test
  });

  it('empty db migrates to latest', () => {
    const { dir, db } = tmpDb();
    try {
      const result = migrate(db);
      expect(result.from).toBe(0);
      expect(result.to).toBe(MIGRATIONS.length);
      const version = db.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
      expect(version).toBe(MIGRATIONS.length);
      const tables = db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      );
      expect(tables.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'api_tokens',
          'tasks',
          'turns',
          'events',
          'approvals',
          'idempotency_keys',
          'audit_log',
          'processes',
        ]),
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('latest db migrate is no-op', () => {
    const { dir, db } = tmpDb();
    try {
      migrate(db);
      const again = migrate(db);
      expect(again.from).toBe(MIGRATIONS.length);
      expect(again.to).toBe(MIGRATIONS.length);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('E33 database newer than program', () => {
    const { dir, db } = tmpDb();
    try {
      migrate(db);
      db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`);
      expect(() => migrate(db)).toThrow(MigrationError);
      expect(() => migrate(db)).toThrow(/比程序支持的/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
