// server/src/api/access.ts
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Scope } from '@agent-hub/contract';
import type { Request } from 'express';
import { getPrincipal } from '../auth/principal';
import { ApiError } from './api-error';

const ACCESS_KEY = 'agent-hub:access';
type Access = { kind: 'public' } | { kind: 'scopes'; scopes: Scope[] };

/** 免鉴权。全项目只有 GET /health 用。 */
export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies Access);

/** 需要这些 scope；不传参数 = 任何已鉴权的主体。UI token 拥有全部 scope。 */
export const Scopes = (...scopes: Scope[]) =>
  SetMetadata(ACCESS_KEY, { kind: 'scopes', scopes } satisfies Access);

/** 全局守卫（APP_GUARD）。没有 @Public / @Scopes 标注的路由只允许 UI token：默认就是管理接口。 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (access?.kind === 'public') return true;
    const principal = getPrincipal(context.switchToHttp().getRequest<Request>());
    if (!access) {
      if (!principal.admin) throw new ApiError('ADMIN_ONLY', '只有 Hub 界面可以调用这个接口');
      return true;
    }
    const missing = access.scopes.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) {
      throw new ApiError('FORBIDDEN_SCOPE', `token 缺少 scope：${missing.join('、')}`, {
        required: missing,
      });
    }
    return true;
  }
}
