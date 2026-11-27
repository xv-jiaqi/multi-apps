import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import {
  STORE_DOWN_RETRY_AFTER_SECONDS,
  rateLimitRedisErrorCount,
  userRateLimitStorePrefix,
} from '../src/bootstrap/rate-limiters';
import { ContentSecurityService } from '../src/modules/content-security/content-security.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';
import { createSignedUser } from './fixtures/signed-user';

/**
 * recordMiniappVisit can turn every counted call into one jscode2session
 * request to WeChat. These tests count what reaches the (stubbed) exchange.
 */

function prefix(): string {
  return `cardhub:rl:test:${randomUUID()}:`;
}

function visit(app: INestApplication, ip: string, token: string, body: unknown = { code: 'c1' }) {
  return request(app.getHttpServer())
    .post('/trpc/contentSecurity.recordMiniappVisit')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', ip)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function stubWeChat(app: INestApplication) {
  const exchanged: string[] = [];
  app.get(ContentSecurityService).useTestHooks({
    env: () => ({
      nodeEnv: 'test',
      appId: 'wx-app',
      appSecret: 'wx-secret',
      callbackToken: '',
      testResult: null,
      credentialsConfigured: true,
    }),
    code2Session: async ({ code }) => {
      exchanged.push(code);
      return { ok: true, openid: `o-${code}` };
    },
  });
  return exchanged;
}

describe('recordMiniappVisit rate limit (CH-249)', () => {
  let app: INestApplication;
  let keyPrefix = '';
  let exchanged: string[] = [];

  beforeAll(async () => {
    keyPrefix = prefix();
    app = await createApp({
      rateLimitPrefix: keyPrefix,
      rateLimitOverrides: { miniappVisit: { limit: 2, windowMs: 60_000 } },
      ipRateLimitOverrides: { miniappVisit: { limit: 5, windowMs: 60_000 } },
    });
    await app.init();
    exchanged = stubWeChat(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    exchanged.length = 0;
  });

  it('answers 429 over the user quota and does not call WeChat again', async () => {
    const user = await createSignedUser(app);
    const ip = '203.0.113.201';
    for (let i = 0; i < 2; i += 1) {
      const res = await visit(app, ip, user.token, { code: `ok-${i}` });
      expect(res.status).toBe(200);
      expect(res.body.result.data).toEqual({ ok: true });
    }
    expect(exchanged).toEqual(['ok-0', 'ok-1']);

    for (let i = 0; i < 3; i += 1) {
      const over = await visit(app, ip, user.token, { code: `random-${i}` });
      expect(over.status).toBe(429);
      expect(over.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
      expect(over.headers['retry-after']).toMatch(/^\d+$/);
    }
    expect(exchanged).toEqual(['ok-0', 'ok-1']);
  });

  it('counts a call with a random invalid code the same way', async () => {
    const user = await createSignedUser(app);
    const ip = '203.0.113.202';
    app.get(ContentSecurityService).useTestHooks({
      code2Session: async ({ code }) => {
        exchanged.push(code);
        return { ok: false, errcode: 40029, reason: 'invalid' };
      },
    });
    try {
      const first = await visit(app, ip, user.token, { code: 'bad-1' });
      const second = await visit(app, ip, user.token, { code: 'bad-2' });
      expect([first.status, second.status]).toEqual([502, 502]);
      const third = await visit(app, ip, user.token, { code: 'bad-3' });
      expect(third.status).toBe(429);
      expect(exchanged).toEqual(['bad-1', 'bad-2']);
    } finally {
      exchanged = stubWeChat(app);
    }
  });

  it('keeps an IP fallback: many accounts behind one IP stop at the IP quota', async () => {
    const ip = '203.0.113.203';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const user = await createSignedUser(app);
      statuses.push((await visit(app, ip, user.token, { code: `ip-${i}` })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(exchanged).toEqual(['ip-0', 'ip-1', 'ip-2', 'ip-3', 'ip-4']);
  });

  it('refuses a banned user before the quota and WeChat', async () => {
    const banned = await createSignedUser(app, { banned: true });
    for (let i = 0; i < 3; i += 1) {
      const res = await visit(app, '203.0.113.204', banned.token, { code: `banned-${i}` });
      expect(res.status).toBe(403);
      expect(res.body.error.data.appCode).toBe(APP_ERROR_CODES.USER_BANNED);
    }
    expect(exchanged).toEqual([]);
    const count = await app
      .get(RedisService)
      .client.get(`${userRateLimitStorePrefix('miniappVisit', keyPrefix)}${banned.id}`);
    expect(count).toBeNull();
    const row = await app.get(PrismaService).user.findUnique({ where: { id: banned.id } });
    expect(row?.wechatOpenid).toBeNull();
  });

  it('refuses a signed-out caller before WeChat', async () => {
    const res = await visit(app, '203.0.113.205', 'not-a-jwt');
    expect(res.status).toBe(401);
    expect(exchanged).toEqual([]);
  });
});

describe('recordMiniappVisit rate limit when Redis is down (CH-249)', () => {
  it('fails closed: 429, no WeChat call, no write', async () => {
    const previousHost = process.env.REDIS_HOST;
    const previousPort = process.env.REDIS_PORT;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6390';
    let app: INestApplication | undefined;
    try {
      app = await createApp({ rateLimitPrefix: prefix() });
      await app.init();
      expect(app.get(RedisService).client.options.port).toBe(6390);
      const exchanged = stubWeChat(app);
      const user = await createSignedUser(app);
      const before = rateLimitRedisErrorCount();

      for (let i = 0; i < 3; i += 1) {
        const res = await visit(app, `203.0.113.${210 + i}`, user.token, { code: `down-${i}` });
        expect(res.status).toBe(429);
        expect(res.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
        expect(res.headers['retry-after']).toBe(String(STORE_DOWN_RETRY_AFTER_SECONDS));
      }
      expect(rateLimitRedisErrorCount()).toBeGreaterThan(before);
      expect(exchanged).toEqual([]);
      const row = await app.get(PrismaService).user.findUnique({ where: { id: user.id } });
      expect(row?.wechatOpenid).toBeNull();
      expect(row?.miniappLastSeenAt).toBeNull();
    } finally {
      await app?.close();
      if (previousHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = previousHost;
      if (previousPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = previousPort;
    }
  });
});
