import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteMirrorRef } from '../adapters/web/types';
import type { Git } from './git';

/** in_place / worktree：工作目录当前内容（含未跟踪、不含被忽略的文件）的树。不碰真实的索引和工作区。 */
export async function snapshotTree(git: Git, cwd: string): Promise<string> {
  const realIndex = (
    await git.run(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  ).trim();
  const dir = await mkdtemp(join(tmpdir(), 'agent-hub-idx-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index'), GIT_OPTIONAL_LOCKS: '0' };
  try {
    try {
      await copyFile(realIndex, env.GIT_INDEX_FILE); // 复用 stat 缓存，大仓库也快
      await git.run(cwd, ['add', '-A'], { env, timeoutMs: 120_000 });
    } catch {
      // 索引不存在，或复制时正被别的 git 进程改写：从 HEAD 重建
      await rm(env.GIT_INDEX_FILE, { force: true });
      await git.run(cwd, ['read-tree', 'HEAD'], { env });
      await git.run(cwd, ['add', '-A'], { env, timeoutMs: 120_000 });
    }
    return (await git.run(cwd, ['write-tree'], { env })).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** remote_branch：镜像 ref 指向的提交的树。不联网，拉取由调用方决定（web-agent.md §4.1）。 */
export async function snapshotRemoteBranch(
  git: Git,
  repoPath: string,
  shortId: string,
): Promise<string> {
  return (
    await git.run(repoPath, ['rev-parse', '--verify', `${remoteMirrorRef(shortId)}^{tree}`])
  ).trim();
}
