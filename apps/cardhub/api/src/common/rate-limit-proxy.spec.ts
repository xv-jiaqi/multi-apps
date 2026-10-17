import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../bootstrap/create-app';
import { productionRateLimitConfigs } from '../bootstrap/rate-limiters';
import { HealthService } from '../modules/health/health.service';

async function makeTestApp(): Promise<INestApplication> {
  const app = await createApp({
    rateLimitOverrides: {
      authMutation: { limit: 1, windowMs: 60_000 },
      commentCreate: { limit: 30, windowMs: 60_000 },
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
  it('keeps the production comments.create limit at 30 per hour', () => {
    expect(productionRateLimitConfigs.commentCreate.windowMs).toBe(3_600_000);
    expect(productionRateLimitConfigs.commentCreate.limit).toBe(30);
  });

  it('sets Vary: Origin on CORS responses for dynamic origins', async () => {
    const app = await makeTestApp();
    try {
      await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://localhost:5173')
        .expect('Vary', /Origin/)
        .expect('Access-Control-Allow-Origin', 'http://localhost:5173')
        .expect(200);
    } finally {
      await app.close();
    }
  });

  it('preserves Origin when tRPC adds its own Vary values on successful responses', async () => {
    const app = await makeTestApp();
    try {
      await request(app.getHttpServer())
        .get('/trpc/health.ping')
        .set('Origin', 'http://localhost:5173')
        .expect(200)
        .expect('Access-Control-Allow-Origin', 'http://localhost:5173')
        .expect((res) => {
          expect(res.headers.vary).toBeDefined();
          const vary = (res.headers.vary as string)
            .split(',')
            .map((item: string) => item.trim().toLowerCase());
          expect(vary).toEqual(expect.arrayContaining(['origin', 'trpc-accept']));
        });
    } finally {
      await app.close();
    }
  });

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
        .expect('Content-Type', /application\/json/)
        .expect(429)
        .expect((res) => {
          expect(res.body).toEqual({
            error: {
              message: 'Too many requests',
              code: -32029,
              data: {
                code: 'TOO_MANY_REQUESTS',
                httpStatus: 429,
                path: 'auth.login',
              },
            },
          });
        });
    } finally {
      await app.close();
    }
  });

  it('returns a tRPC-shaped JSON error array for throttled batch requests', async () => {
    const app = await makeTestApp();
    try {
      await request(app.getHttpServer())
        .get('/trpc/auth.login,auth.register?batch=1')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect((res) => expect(res.status).not.toBe(429));
      await request(app.getHttpServer())
        .get('/trpc/auth.login,auth.register?batch=1')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect('Content-Type', /application\/json/)
        .expect(429)
        .expect((res) => {
          expect(res.body).toEqual([
            {
              error: {
                message: 'Too many requests',
                code: -32029,
                data: {
                  code: 'TOO_MANY_REQUESTS',
                  httpStatus: 429,
                  path: 'auth.login',
                },
              },
            },
            {
              error: {
                message: 'Too many requests',
                code: -32029,
                data: {
                  code: 'TOO_MANY_REQUESTS',
                  httpStatus: 429,
                  path: 'auth.register',
                },
              },
            },
          ]);
        });
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

  it('throttles comments.create on the 31st request per IP', async () => {
    const app = await makeTestApp();
    try {
      for (let i = 0; i < 30; i += 1) {
        await request(app.getHttpServer())
          .get('/trpc/comments.create')
          .set('X-Forwarded-For', '203.0.113.20')
          .expect((res) => expect(res.status).not.toBe(429));
      }

      await request(app.getHttpServer())
        .get('/trpc/comments.create')
        .set('X-Forwarded-For', '203.0.113.20')
        .expect('Content-Type', /application\/json/)
        .expect(429)
        .expect((res) => {
          expect(res.body).toEqual({
            error: {
              message: 'Too many requests',
              code: -32029,
              data: {
                code: 'TOO_MANY_REQUESTS',
                httpStatus: 429,
                path: 'comments.create',
              },
            },
          });
        });
    } finally {
      await app.close();
    }
  });
});
