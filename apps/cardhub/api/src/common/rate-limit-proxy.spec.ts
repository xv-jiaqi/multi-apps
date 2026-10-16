import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../bootstrap/create-app';
import { HealthService } from '../modules/health/health.service';

async function makeTestApp(): Promise<INestApplication> {
  const app = await createApp({
    rateLimitOverrides: {
      authMutation: { limit: 1, windowMs: 60_000 },
    },
  });
  jest.spyOn(app.get(HealthService), 'check').mockResolvedValue({
    status: 'ok',
    uptime: 1,
    services: { db: true, redis: true },
    gitSha: 'test-sha',
    buildTime: 'test-build-time',
  });
  await app.init();

  return app;
}

describe('rate limit proxy IP handling', () => {
  it('never throttles /health through the real bootstrap path', async () => {
    const app = await makeTestApp();
    try {
      for (let i = 0; i < 65; i += 1) {
        await request(app.getHttpServer())
          .get('/health')
          .set('X-Forwarded-For', '203.0.113.10')
          .expect(200);
      }
    } finally {
      await app.close();
    }
  });

  it('throttles real auth tRPC routes after the configured max', async () => {
    const app = await makeTestApp();
    try {
      await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect((res) => expect(res.status).not.toBe(429));
      await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect(429);
    } finally {
      await app.close();
    }
  });

  it('uses separate buckets for different client IPs and ignores spoofed extra XFF entries', async () => {
    const app = await makeTestApp();
    try {
      await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect((res) => expect(res.status).not.toBe(429));
      await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.11')
        .expect((res) => expect(res.status).not.toBe(429));
      await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '198.51.100.250, 203.0.113.10')
        .expect(429);
    } finally {
      await app.close();
    }
  });
});
