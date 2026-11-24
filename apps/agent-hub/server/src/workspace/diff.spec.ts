import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffTrees } from './diff';
import { createGit } from './git';
import { snapshotTree } from './snapshot';

describe('snapshotTree + diffTrees', () => {
  let dir: string;
  const git = createGit(process.env);
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ah-diff-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a]);
    g('init', '-q');
    writeFileSync(join(dir, 'keep.txt'), 'one\ntwo\n');
    writeFileSync(join(dir, 'gone.txt'), 'bye\n');
    writeFileSync(join(dir, 'move.txt'), 'same content here\nline2\nline3\n');
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('新增 / 修改 / 删除 / 改名，且不碰真实索引', async () => {
    const before = await snapshotTree(git, dir);
    writeFileSync(join(dir, 'keep.txt'), 'one\nTWO\nthree\n');
    unlinkSync(join(dir, 'gone.txt'));
    renameSync(join(dir, 'move.txt'), join(dir, 'moved.txt'));
    writeFileSync(join(dir, 'new.bin'), Buffer.from([0, 1, 2, 3]));
    const after = await snapshotTree(git, dir);
    const d = await diffTrees(git, dir, before, after);
    const by = Object.fromEntries(d.stats.files.map((f) => [f.path, f]));
    expect(by['keep.txt']).toMatchObject({ status: 'modified', insertions: 2, deletions: 1 });
    expect(by['gone.txt']).toMatchObject({ status: 'deleted', deletions: 1 });
    expect(by['moved.txt']).toMatchObject({ status: 'renamed', oldPath: 'move.txt' });
    expect(by['new.bin']).toMatchObject({ status: 'added', binary: true });
    expect(d.patch).toContain('+TWO');
    const status = execFileSync('git', ['-C', dir, 'status', '--porcelain']).toString();
    expect(status).toContain('?? moved.txt'); // 真实索引未被 add
  });

  it('同一棵树 → 空 diff', async () => {
    const t = await snapshotTree(git, dir);
    const d = await diffTrees(git, dir, t, t);
    expect(d.stats.filesChanged).toBe(0);
    expect(d.patch).toBe('');
  });
});
