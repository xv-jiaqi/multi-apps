import { TRPCError } from '@trpc/server';
import { APP_ERROR_CODES, t } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import type { TrpcContext } from '../../trpc/context';
import type { UserRateLimiter } from '../../bootstrap/rate-limiters';
import { ContentSecurityRouter } from './content-security.router';
import { stubContentSecurity } from './content-security.test-stub';

function member(overrides: Partial<NonNullable<TrpcContext['user']>> = {}): TrpcContext['user'] {
  return {
    sub: 'user-1',
    username: 'alice',
    role: 'user',
    tokenVersion: 1,
    bannedAt: null,
    ...overrides,
  };
}

const allowAll: UserRateLimiter = {
  hit: async () => ({ limited: false, totalHits: 1, limit: 10 }),
};

function makeCaller(
  recordMiniappVisit: (input: { userId: string; code?: string }) => Promise<void> = async () =>
    undefined,
  userRateLimit: UserRateLimiter = allowAll,
) {
  const contentSecurity = stubContentSecurity({
    recordMiniappVisit: jest.fn(recordMiniappVisit),
  });
  const router = new ContentSecurityRouter(new TrpcBase(), contentSecurity).build();
  return {
    contentSecurity,
    call: (user: TrpcContext['user']) =>
      router.createCaller({
        req: {} as never,
        res: {} as never,
        user,
        userRateLimit,
      }),
  };
}

describe('contentSecurity.recordMiniappVisit', () => {
  it('records a visit with the login code and returns only { ok: true }', async () => {
    const seen: { userId: string; code?: string }[] = [];
    const { call } = makeCaller(async (input) => {
      seen.push(input);
    });
    const result = await call(member()).recordMiniappVisit({ code: 'js-code-1' });
    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toMatch(/openid|session_key/i);
    expect(seen).toEqual([{ userId: 'user-1', code: 'js-code-1' }]);
  });

  it('rejects a signed-out caller', async () => {
    const { call, contentSecurity } = makeCaller();
    await expect(call(null).recordMiniappVisit({ code: 'js-code-1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(contentSecurity.recordMiniappVisit).not.toHaveBeenCalled();
  });

  it('does not expose WeChat or secret text when the service is unconfigured', async () => {
    const { call } = makeCaller(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: t('zh-CN', 'error.app.MINIAPP_NOT_CONFIGURED'),
        cause: { appCode: APP_ERROR_CODES.MINIAPP_NOT_CONFIGURED },
      });
    });
    const error = await call(member())
      .recordMiniappVisit({ code: 'js-code-1' })
      .catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      code: 'PRECONDITION_FAILED',
      cause: { appCode: APP_ERROR_CODES.MINIAPP_NOT_CONFIGURED },
    });
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBe('小程序登录未配置，请稍后再试或联系管理员');
    expect(message).not.toMatch(/WECHAT_|APP_SECRET|openid|session_key|process\.env/i);
  });

  it('answers ok to a legacy openid-only payload and never passes the openid to the service', async () => {
    const { call, contentSecurity } = makeCaller();
    const result = await call(member()).recordMiniappVisit({ openid: 'o-spoofed' });
    expect(result).toEqual({ ok: true });
    expect(contentSecurity.recordMiniappVisit).toHaveBeenCalledTimes(1);
    expect(contentSecurity.recordMiniappVisit).toHaveBeenCalledWith({
      userId: 'user-1',
      code: undefined,
    });
  });

  it('passes only the login code when both fields are present', async () => {
    const seen: { userId: string; code?: string }[] = [];
    const { call } = makeCaller(async (input) => {
      seen.push(input);
    });
    const result = await call(member()).recordMiniappVisit({
      code: 'js-code-1',
      openid: 'o-spoofed',
    });
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual([{ userId: 'user-1', code: 'js-code-1' }]);
  });

  it('rejects a banned caller before the quota and the service', async () => {
    const hit = jest.fn(allowAll.hit);
    const { call, contentSecurity } = makeCaller(undefined, { hit });
    await expect(
      call(member({ bannedAt: new Date() })).recordMiniappVisit({ code: 'js-code-1' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: APP_ERROR_CODES.USER_BANNED },
    });
    expect(hit).not.toHaveBeenCalled();
    expect(contentSecurity.recordMiniappVisit).not.toHaveBeenCalled();
  });

  it('counts the call on the miniappVisit quota and refuses over it before the service', async () => {
    const hit = jest.fn<ReturnType<UserRateLimiter['hit']>, Parameters<UserRateLimiter['hit']>>(
      async () => ({ limited: true, totalHits: 11, limit: 10, retryAfterSeconds: 30 }),
    );
    const { call, contentSecurity } = makeCaller(undefined, { hit });
    await expect(call(member()).recordMiniappVisit({ code: 'js-code-1' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      cause: { appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS },
    });
    expect(hit).toHaveBeenCalledWith('miniappVisit', 'user-1');
    expect(contentSecurity.recordMiniappVisit).not.toHaveBeenCalled();
  });

  it('fails closed when the context has no limiter', async () => {
    const { contentSecurity } = makeCaller();
    const router = new ContentSecurityRouter(new TrpcBase(), contentSecurity).build();
    await expect(
      router
        .createCaller({ req: {} as never, res: {} as never, user: member() })
        .recordMiniappVisit({ code: 'js-code-1' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(contentSecurity.recordMiniappVisit).not.toHaveBeenCalled();
  });
});
