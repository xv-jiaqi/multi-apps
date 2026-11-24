import type { DiffFileStat, DiffStats } from '@agent-hub/contract';
import type { Git } from './git';

export const MAX_STORED_PATCH_BYTES = 5 * 1024 * 1024;
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface TreeDiff {
  stats: DiffStats;
  /** 超过 5 MB 时为 null，truncated = true。 */
  patch: string | null;
  truncated: boolean;
}

function statusOf(code: string): DiffFileStat['status'] {
  switch (code[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return 'modified';
  }
}

/** 两棵树之间的统计与补丁（architecture.md §7.2）。 */
export async function diffTrees(
  git: Git,
  cwd: string,
  from: string,
  to: string,
): Promise<TreeDiff> {
  if (from === to) {
    return {
      stats: { filesChanged: 0, insertions: 0, deletions: 0, files: [] },
      patch: '',
      truncated: false,
    };
  }
  const nameStatus = await git.run(cwd, [
    'diff',
    '--no-ext-diff',
    '-M',
    '--name-status',
    '-z',
    from,
    to,
  ]);
  const numstat = await git.run(cwd, ['diff', '--no-ext-diff', '-M', '--numstat', '-z', from, to]);

  // --name-status -z：STATUS\0path\0 或 Rxxx\0old\0new\0
  const ns = nameStatus.split('\0').filter((x, i, arr) => !(x === '' && i === arr.length - 1));
  const files: DiffFileStat[] = [];
  for (let i = 0; i < ns.length; ) {
    const code = ns[i++]!;
    if (!code) break;
    if (code.startsWith('R') || code.startsWith('C')) {
      const oldPath = ns[i++]!;
      const path = ns[i++]!;
      files.push({ path, oldPath, status: 'renamed', insertions: 0, deletions: 0, binary: false });
    } else {
      const path = ns[i++]!;
      files.push({
        path,
        oldPath: null,
        status: statusOf(code),
        insertions: 0,
        deletions: 0,
        binary: false,
      });
    }
  }
  // --numstat -z：ins\tdel\tpath\0 或 ins\tdel\t\0old\0new\0
  const parts = numstat.split('\0');
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (let i = 0; i < parts.length; ) {
    const head = parts[i++]!;
    if (!head) continue;
    const [ins, del, maybePath] = head.split('\t');
    let path = maybePath ?? '';
    if (path === '') {
      i++; // old
      path = parts[i++] ?? '';
    }
    const f = byPath.get(path);
    if (!f) continue;
    if (ins === '-' || del === '-') f.binary = true;
    else {
      f.insertions = Number(ins);
      f.deletions = Number(del);
    }
  }
  const stats: DiffStats = {
    filesChanged: files.length,
    insertions: files.reduce((n, f) => n + f.insertions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    files,
  };
  const r = await git
    .exec(cwd, ['diff', '--no-ext-diff', '--no-color', '-M', '--binary', from, to], {
      maxStdoutBytes: MAX_STORED_PATCH_BYTES + 1,
    })
    .catch(() => null);
  if (!r || r.code !== 0 || Buffer.byteLength(r.stdout, 'utf8') > MAX_STORED_PATCH_BYTES) {
    return { stats, patch: null, truncated: true };
  }
  return { stats, patch: r.stdout, truncated: false };
}
