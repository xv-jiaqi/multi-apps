import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Git } from './git';

export function worktreePath(worktreesRoot: string, repoId: string, shortId: string): string {
  return join(worktreesRoot, repoId, shortId);
}

export function taskBranch(shortId: string): string {
  return `agent-hub/${shortId}`;
}

/** architecture.md §7.1：git worktree add -b agent-hub/<shortId> <path> <base>。已存在则复用。 */
export async function ensureWorktree(
  git: Git,
  repoPath: string,
  path: string,
  shortId: string,
  baseCommit: string,
): Promise<void> {
  if (existsSync(path)) {
    const head = (await git.run(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (head === taskBranch(shortId)) return;
    throw new Error(`worktree 目录已存在且不是 ${taskBranch(shortId)}：${path}`);
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  await git.run(repoPath, ['worktree', 'add', '-b', taskBranch(shortId), path, baseCommit], {
    timeoutMs: 120_000,
  });
}

/** baseRef 依次取：任务指定 → 仓库 defaultBaseRef → HEAD。 */
export async function resolveBase(
  git: Git,
  repoPath: string,
  baseRef: string | null,
): Promise<string> {
  return (
    await git.run(repoPath, ['rev-parse', '--verify', `${baseRef ?? 'HEAD'}^{commit}`])
  ).trim();
}
