// server/src/auth/principal.ts
import type { IncomingMessage } from 'node:http';
import { SCOPES, type Scope, type TaskDto } from '@agent-hub/contract';
import { ApiError } from '../api/api-error';

export type Principal =
  | { kind: 'ui'; tokenId: null; scopes: readonly Scope[]; admin: true }
  | { kind: 'bridge'; tokenId: string; scopes: readonly Scope[]; admin: false };

export const UI_PRINCIPAL: Principal = { kind: 'ui', tokenId: null, scopes: SCOPES, admin: true };

const principals = new WeakMap<IncomingMessage, Principal>();

export function setPrincipal(req: IncomingMessage, principal: Principal): void {
  principals.set(req, principal);
}

export function findPrincipal(req: IncomingMessage): Principal | undefined {
  return principals.get(req);
}

export function getPrincipal(req: IncomingMessage): Principal {
  const principal = principals.get(req);
  if (!principal) throw new Error('请求没有经过鉴权中间件');
  return principal;
}

/** 桥接 token 只能管理自己创建的任务；UI token 不受限。 */
export function assertOwns(principal: Principal, task: Pick<TaskDto, 'sourceTokenId'>): void {
  if (principal.kind === 'bridge' && task.sourceTokenId !== principal.tokenId) {
    throw new ApiError('TASK_NOT_OWNED', '只能操作本 token 创建的任务');
  }
}
