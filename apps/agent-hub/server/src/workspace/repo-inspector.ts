import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RepoInspectionDto, RepoRemoteDto } from '@agent-hub/contract';
import type { Git } from './git';

export function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

function stripUserinfo(url: string | null): string | null {
  if (!url) return url;
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, '$1');
}

/** 仓库体检（只读）。PR2 只做本地 Agent 需要的部分：是 git 仓库、有提交、remote 列表。 */
export async function inspectRepo(git: Git, rawPath: string): Promise<RepoInspectionDto> {
  const path = expandHome(rawPath);
  const problems: string[] = [];
  const out: RepoInspectionDto = {
    ok: false,
    problems,
    topLevel: null,
    currentBranch: null,
    head: null,
    dirty: false,
    remotes: [],
    originPushDisabled: false,
    internalPushHost: null,
  };
  const top = await git.exec(path, ['rev-parse', '--show-toplevel']).catch(() => null);
  if (!top || top.code !== 0) {
    problems.push('不是 git 仓库');
    return out;
  }
  out.topLevel = top.stdout.trim();
  const head = await git.exec(path, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (head.code !== 0) problems.push('仓库还没有任何提交');
  else out.head = head.stdout.trim();
  const branch = await git.exec(path, ['symbolic-ref', '--short', '-q', 'HEAD']);
  out.currentBranch = branch.code === 0 ? branch.stdout.trim() : null;
  const status = await git.exec(path, ['status', '--porcelain', '-uno']);
  out.dirty = status.code === 0 && status.stdout.trim() !== '';
  const names = (await git.exec(path, ['remote'])).stdout.split('\n').filter(Boolean);
  const remotes: RepoRemoteDto[] = [];
  for (const name of names) {
    const fetch = await git.exec(path, ['remote', 'get-url', name]);
    const push = await git.exec(path, ['remote', 'get-url', '--push', name]);
    remotes.push({
      name,
      fetchUrl: stripUserinfo(fetch.code === 0 ? fetch.stdout.trim() : null),
      pushUrl: stripUserinfo(push.code === 0 ? push.stdout.trim() : null),
    });
    if (name === 'origin' && push.code === 0 && push.stdout.trim() === 'DISABLED')
      out.originPushDisabled = true;
  }
  out.remotes = remotes;
  out.ok = problems.length === 0;
  return out;
}
