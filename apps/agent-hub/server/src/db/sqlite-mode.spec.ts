import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from './sqlite';

describe('Db file mode', () => {
  it('hub.db is mode 0600 after open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ah-dbmode-'));
    const file = join(dir, 'hub.db');
    const db = new Db(file);
    try {
      const mode = statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
