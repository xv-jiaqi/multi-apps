import { TrpcBase } from '../../trpc/trpc-base';
import { HealthRouter } from './health.router';
import type { HealthService } from './health.service';

function makeCaller(metadata: ReturnType<HealthService['metadata']>) {
  const health = {
    metadata: jest.fn().mockReturnValue(metadata),
  } as unknown as HealthService;
  const router = new HealthRouter(new TrpcBase(), health);
  const caller = router.build().createCaller({
    req: {} as never,
    res: {} as never,
    user: null,
  });

  return { caller, health };
}

describe('HealthRouter.ping', () => {
  it('returns deployment metadata for tRPC health checks', async () => {
    const { caller, health } = makeCaller({
      gitSha: 'abc123',
      buildTime: '2026-10-16T08:00:00Z',
    });

    await expect(caller.ping()).resolves.toMatchObject({
      status: 'ok',
      message: '欢迎来到 Cardhub',
      gitSha: 'abc123',
      buildTime: '2026-10-16T08:00:00Z',
    });
    expect(health.metadata).toHaveBeenCalledTimes(1);
  });
});
