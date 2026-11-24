import { randomBytes } from 'node:crypto';

export function newId(prefix = ''): string {
  return `${prefix}${randomBytes(16).toString('hex')}`;
}

/** 8 位短 id，用于分支名 / worktree 路径。 */
export function newShortId(): string {
  return randomBytes(4).toString('hex');
}
