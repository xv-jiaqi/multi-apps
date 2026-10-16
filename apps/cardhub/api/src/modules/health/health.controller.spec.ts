import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

function makeController(result: Awaited<ReturnType<HealthService['check']>>) {
  const health = {
    check: jest.fn().mockResolvedValue(result),
  } as unknown as HealthService;
  const controller = new HealthController(health);
  const res = { status: jest.fn() };

  return { controller, health, res };
}

describe('HealthController', () => {
  it('returns 200-compatible payload when database is reachable', async () => {
    const { controller, res } = makeController({
      status: 'ok',
      uptime: 12.3,
      services: { db: true, redis: true },
      gitSha: 'abc123',
      buildTime: '2026-10-16T08:00:00Z',
    });

    await expect(controller.check(res as never)).resolves.toMatchObject({
      status: 'ok',
      services: { db: true, redis: true },
      gitSha: 'abc123',
      buildTime: '2026-10-16T08:00:00Z',
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns HTTP 503 when database is unreachable while preserving health fields', async () => {
    const { controller, res } = makeController({
      status: 'ok',
      uptime: 12.3,
      services: { db: false, redis: true },
      gitSha: 'abc123',
      buildTime: '2026-10-16T08:00:00Z',
    });

    await expect(controller.check(res as never)).resolves.toMatchObject({
      status: 'ok',
      services: { db: false, redis: true },
      gitSha: 'abc123',
      buildTime: '2026-10-16T08:00:00Z',
    });
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
