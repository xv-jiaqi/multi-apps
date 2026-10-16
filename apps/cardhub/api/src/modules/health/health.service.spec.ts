import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

function makeService() {
  const prisma = {
    $queryRaw: jest.fn(),
  } as unknown as PrismaService & { $queryRaw: jest.Mock };
  const redis = {
    ping: jest.fn(),
  } as unknown as RedisService & { ping: jest.Mock };

  return { service: new HealthService(prisma, redis), prisma, redis };
}

describe('HealthService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reads gitSha/buildTime from env with unknown fallbacks', () => {
    const { service } = makeService();
    process.env.GIT_SHA = 'abc123';
    process.env.BUILD_TIME = '2026-10-16T08:00:00Z';

    expect(service.metadata()).toEqual({
      gitSha: 'abc123',
      buildTime: '2026-10-16T08:00:00Z',
    });

    process.env.GIT_SHA = '   ';
    delete process.env.BUILD_TIME;
    expect(service.metadata()).toEqual({
      gitSha: 'unknown',
      buildTime: 'unknown',
    });
  });

  it('reports db=false when the database probe fails', async () => {
    const { service, prisma, redis } = makeService();
    prisma.$queryRaw.mockRejectedValueOnce(new Error('database unavailable'));
    redis.ping.mockResolvedValueOnce(true);

    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      services: { db: false, redis: true },
      gitSha: 'unknown',
      buildTime: 'unknown',
    });
  });
});
