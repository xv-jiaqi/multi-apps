import { TRPCError } from '@trpc/server';
import { TrpcBase } from './trpc-base';
import type { TrpcContext } from './context';

const user: NonNullable<TrpcContext['user']> = {
  sub: 'user-1',
  username: 'u1',
  role: 'user',
  tokenVersion: 0,
  bannedAt: null,
};

function build() {
  const t = new TrpcBase();
  let ran = 0;
  const router = t.router({
    write: t.activeUserProcedure.use(t.userRateLimit('forumTopicCreate')).mutation(() => {
      ran += 1;
      return 'ok';
    }),
  });
  return { router, ran: () => ran };
}

describe('userRateLimit middleware', () => {
  it('fails closed when the context has no limiter', async () => {
    const { router, ran } = build();
    const caller = router.createCaller({ req: {} as never, res: {} as never, user });
    await expect(caller.write()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(ran()).toBe(0);
  });

  it('does not run the procedure once the limiter says limited', async () => {
    const { router, ran } = build();
    const caller = router.createCaller({
      req: {} as never,
      res: {} as never,
      user,
      userRateLimit: {
        hit: async () => ({ limited: true, totalHits: 6, limit: 5, retryAfterSeconds: 30 }),
      },
    });
    const error = await caller.write().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: '操作太频繁，请稍后再试',
      cause: { appCode: 'TOO_MANY_REQUESTS' },
    });
    expect(ran()).toBe(0);
  });
});
