import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_ERROR_CODES } from '@repo/shared';
import { createApp } from '../bootstrap/create-app';
import {
  IP_FALLBACK_MULTIPLIER,
  productionRateLimitConfigs,
  userRateLimitConfigs,
} from '../bootstrap/rate-limiters';
import { HealthService } from '../modules/health/health.service';
import { createSignedUser } from '../../test/fixtures/signed-user';

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
  it('keeps the production comments.create limit at 30 per hour per user, 300 per IP', () => {
    expect(userRateLimitConfigs.commentCreate).toEqual({ windowMs: 3_600_000, limit: 30 });
    expect(productionRateLimitConfigs.commentCreate.windowMs).toBe(3_600_000);
    expect(productionRateLimitConfigs.commentCreate.limit).toBe(300);
  });

  it('keeps the production collection.upsert limit at 60 per minute per user, 600 per IP', () => {
    expect(userRateLimitConfigs.collectionUpsert).toEqual({ windowMs: 60_000, limit: 60 });
    expect(productionRateLimitConfigs.collectionUpsert.windowMs).toBe(60_000);
    expect(productionRateLimitConfigs.collectionUpsert.limit).toBe(600);
    expect(productionRateLimitConfigs.collectionUpsert.skip({ url: '/trpc/collection.list' })).toBe(
      true,
    );
    expect(
      productionRateLimitConfigs.collectionUpsert.skip({ url: '/trpc/collection.upsert' }),
    ).toBe(false);
  });

  it('27-12: user and IP layers match CH-227 §1 and §2 27-C', () => {
    const hour = 3_600_000;
    expect(userRateLimitConfigs).toEqual({
      commentCreate: { windowMs: hour, limit: 30 },
      forumTopicCreate: { windowMs: hour, limit: 5 },
      forumReplyCreate: { windowMs: hour, limit: 30 },
      listingPublish: { windowMs: hour, limit: 10 },
      reportCreate: { windowMs: hour, limit: 20 },
      collectionUpsert: { windowMs: 60_000, limit: 60 },
    });
    expect(IP_FALLBACK_MULTIPLIER).toBe(10);
    const ip = Object.fromEntries(
      Object.entries(productionRateLimitConfigs).map(([name, config]) => [
        name,
        { windowMs: config.windowMs, limit: config.limit },
      ]),
    );
    expect(ip).toEqual({
      authMutation: { windowMs: 60_000, limit: 10 },
      commentCreate: { windowMs: hour, limit: 300 },
      forumTopicCreate: { windowMs: hour, limit: 50 },
      forumReplyCreate: { windowMs: hour, limit: 300 },
      listingPublish: { windowMs: hour, limit: 100 },
      reportCreate: { windowMs: hour, limit: 200 },
      collectionUpsert: { windowMs: 60_000, limit: 600 },
    });
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
              message: '操作太频繁，请稍后再试',
              code: -32029,
              data: {
                code: 'TOO_MANY_REQUESTS',
                appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
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

  it('rejects a batch of two auth writes before either one is counted', async () => {
    const app = await makeTestApp();
    try {
      await request(app.getHttpServer())
        .get('/trpc/auth.login,auth.register?batch=1')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect('Content-Type', /application\/json/)
        .expect(400)
        .expect((res) => {
          expect(res.body).toEqual({
            error: {
              message: '请求无效，请检查后再试',
              code: -32600,
              data: {
                code: 'BAD_REQUEST',
                appCode: APP_ERROR_CODES.BAD_REQUEST,
                httpStatus: 400,
              },
            },
          });
          expect(JSON.stringify(res.body)).not.toContain('Batch');
        });
      await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.10')
        .expect((res) => expect(res.status).not.toBe(429));
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

  it('throttles comments.create on the 31st call per user, from any IP', async () => {
    const app = await makeTestApp();
    try {
      const user = await createSignedUser(app);
      const call = (ip: string) =>
        request(app.getHttpServer())
          .post('/trpc/comments.create')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${user.token}`)
          .set('X-Forwarded-For', ip)
          .send({ cardSlug: 'rl-missing-card', content: 'counted' });
      // Each call reaches the handler (missing card = 404) and still counts.
      for (let i = 0; i < 30; i += 1) {
        await call(`203.0.113.${20 + (i % 3)}`).expect(404);
      }

      await call('203.0.113.29')
        .expect('Content-Type', /application\/json/)
        .expect(429)
        .expect((res) => {
          expect(res.body.error.message).toBe('操作太频繁，请稍后再试');
          expect(res.body.error.code).toBe(-32029);
          expect(res.body.error.data).toMatchObject({
            code: 'TOO_MANY_REQUESTS',
            appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
            httpStatus: 429,
            path: 'comments.create',
          });
        });
    } finally {
      await app.close();
    }
  });

  it('throttles comments.createForSeries on the 301st request per IP (fallback, 401s count)', async () => {
    const app = await makeTestApp();
    try {
      for (let i = 0; i < 300; i += 1) {
        await request(app.getHttpServer())
          .post('/trpc/comments.createForSeries')
          .set('Content-Type', 'application/json')
          .set('X-Forwarded-For', '203.0.113.21')
          .send({ seriesSlug: 'rl-series', content: 'anonymous' })
          .expect(401);
      }

      await request(app.getHttpServer())
        .post('/trpc/comments.createForSeries')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', '203.0.113.21')
        .send({ seriesSlug: 'rl-series', content: 'anonymous' })
        .expect(429)
        .expect((res) => {
          expect(res.body).toEqual({
            error: {
              message: '操作太频繁，请稍后再试',
              code: -32029,
              data: {
                code: 'TOO_MANY_REQUESTS',
                appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
                httpStatus: 429,
                path: 'comments.createForSeries',
              },
            },
          });
        });
    } finally {
      await app.close();
    }
  });
});
