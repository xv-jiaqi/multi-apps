import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, t } from '@repo/shared';
import * as trpcExpress from '@trpc/server/adapters/express';
import express from 'express';
import { createApp } from '../src/bootstrap/create-app';
import { subscribeLogLines } from '../src/bootstrap/http-logger';
import { userRateLimitStorePrefix, type WriteRateLimitName } from '../src/bootstrap/rate-limiters';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { TrpcService } from '../src/trpc/trpc.service';
import { makeCreateContext } from '../src/trpc/context';
import { RedisService } from '../src/modules/redis/redis.service';
import { createSignedUser } from './fixtures/signed-user';

const TOO_MANY = t('zh-CN', 'error.app.TOO_MANY_REQUESTS');

function testPrefix(): string {
  return `cardhub:rl:test:${randomUUID()}:`;
}

function post(app: INestApplication, path: string, body: unknown, ip: string, token?: string) {
  const req = request(app.getHttpServer())
    .post(`/trpc/${path}`)
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', ip);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
}

async function withProductionErrors<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

/** The 429 body the IP layer already sends, with no stack or internal text. */
function tooManyBody(path: string) {
  return {
    error: {
      message: TOO_MANY,
      code: -32029,
      data: {
        code: 'TOO_MANY_REQUESTS',
        appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
        httpStatus: 429,
        path,
      },
    },
  };
}

describe('per-user write rate limits (CH-227)', () => {
  let app: INestApplication;
  let prefix = '';

  beforeAll(async () => {
    prefix = testPrefix();
    app = await createApp({ rateLimitPrefix: prefix });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  function userCount(name: WriteRateLimitName, userId: string, base = prefix) {
    return app.get(RedisService).client.get(`${userRateLimitStorePrefix(name, base)}${userId}`);
  }

  const topicBody = { title: '限流测试', body: '正文' };

  it('27-6: 401 and banned calls from the same IP do not use a user quota', async () => {
    const ip = '203.0.113.160';
    for (let i = 0; i < 6; i += 1) {
      const res = await post(app, 'forum.topics.create', topicBody, ip, 'not-a-jwt');
      expect(res.status).toBe(401);
      expect(res.body.error.data.appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
    }
    const banned = await createSignedUser(app, { banned: true });
    for (let i = 0; i < 2; i += 1) {
      const res = await post(app, 'forum.topics.create', topicBody, ip, banned.token);
      expect(res.status).toBe(403);
      expect(res.body.error.data.appCode).toBe(APP_ERROR_CODES.USER_BANNED);
    }
    expect(await userCount('forumTopicCreate', banned.id)).toBeNull();

    const a = await createSignedUser(app);
    for (let i = 0; i < 5; i += 1) {
      const res = await post(app, 'forum.topics.create', topicBody, ip, a.token);
      expect(res.status).toBe(200);
    }
    const sixth = await post(app, 'forum.topics.create', topicBody, ip, a.token);
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
  });

  it('27-8: a batch with two forum.topics.create adds 2 to the user count', async () => {
    const a = await createSignedUser(app);
    const res = await request(app.getHttpServer())
      .post('/trpc/forum.topics.create,forum.topics.create?batch=1')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.161')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ 0: topicBody, 1: topicBody });
    expect(res.status).toBe(200);
    expect(await userCount('forumTopicCreate', a.id)).toBe('2');
    for (let i = 0; i < 3; i += 1) {
      const next = await post(app, 'forum.topics.create', topicBody, '203.0.113.161', a.token);
      expect(next.status).toBe(200);
    }
    expect(await userCount('forumTopicCreate', a.id)).toBe('5');
  });

  it('counts a call that fails input validation', async () => {
    const a = await createSignedUser(app);
    const res = await post(app, 'forum.topics.create', { title: '' }, '203.0.113.162', a.token);
    expect(res.status).toBe(400);
    expect(await userCount('forumTopicCreate', a.id)).toBe('1');
  });

  it('27-9: over the limit is 429 with the shared body; in a batch only that call fails', async () => {
    const a = await createSignedUser(app);
    const ip = '203.0.113.163';
    for (let i = 0; i < 4; i += 1) {
      expect((await post(app, 'forum.topics.create', topicBody, ip, a.token)).status).toBe(200);
    }
    await withProductionErrors(async () => {
      const batch = await request(app.getHttpServer())
        .post('/trpc/forum.topics.create,forum.topics.create?batch=1')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', ip)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ 0: topicBody, 1: topicBody });
      // tRPC answers a batch with mixed outcomes as 207; each slot keeps its own status.
      expect(batch.status).toBe(207);
      expect(batch.body).toHaveLength(2);
      expect(batch.body[0].result.data.title).toBe(topicBody.title);
      expect(batch.body[1]).toEqual(tooManyBody('forum.topics.create'));

      const single = await post(app, 'forum.topics.create', topicBody, ip, a.token);
      expect(single.status).toBe(429);
      expect(single.headers['content-type']).toMatch(/application\/json/);
      expect(single.body).toEqual(tooManyBody('forum.topics.create'));
      expect(single.body.error.message).toBe('操作太频繁，请稍后再试');
      expect(JSON.stringify(single.body)).not.toMatch(/redis|stack|node_modules|rate limit/i);
    });
  });
});

describe('27-7: users behind one IP each get their own quota, for all six limiters', () => {
  let app: INestApplication;
  let calls: Record<WriteRateLimitName, { path: string; body: () => unknown }>;
  let commentSeries = '';
  let commentCard = '';

  beforeAll(async () => {
    app = await createApp({
      rateLimitPrefix: testPrefix(),
      rateLimitOverrides: {
        commentCreate: { limit: 2, windowMs: 60_000 },
        forumTopicCreate: { limit: 2, windowMs: 60_000 },
        forumReplyCreate: { limit: 2, windowMs: 60_000 },
        listingPublish: { limit: 2, windowMs: 60_000 },
        reportCreate: { limit: 2, windowMs: 60_000 },
        collectionUpsert: { limit: 2, windowMs: 60_000 },
      },
    });
    await app.init();
    const prisma = app.get(PrismaService);
    const suffix = randomUUID().slice(0, 8);
    commentSeries = `rl7-series-${suffix}`;
    commentCard = `rl7-card-${suffix}`;
    const series = await prisma.series.create({ data: { slug: commentSeries, title: '限流系列' } });
    await prisma.card.create({ data: { slug: commentCard, name: '限流卡', seriesId: series.id } });
    const owner = await createSignedUser(app);
    const topic = await prisma.topic.create({
      data: { slug: `rl7-topic-${suffix}`, title: '限流帖', body: '正文', userId: owner.id },
    });
    calls = {
      commentCreate: {
        path: 'comments.create',
        body: () => ({ cardSlug: commentCard, content: '评论' }),
      },
      forumTopicCreate: {
        path: 'forum.topics.create',
        body: () => ({ title: '帖', body: '正文' }),
      },
      forumReplyCreate: {
        path: 'forum.replies.create',
        body: () => ({ topicId: topic.id, body: '回帖' }),
      },
      listingPublish: {
        path: 'listings.publish',
        body: () => ({ cardSlug: commentCard, kind: 'BUY', contact: 'wx-cardhub' }),
      },
      reportCreate: {
        path: 'reports.create',
        body: () => ({ targetType: 'TOPIC', targetId: topic.id, reason: '广告内容' }),
      },
      collectionUpsert: {
        path: 'collection.upsert',
        body: () => ({ cardSlug: commentCard, ownedCount: 1, wanted: false }),
      },
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    'commentCreate',
    'forumTopicCreate',
    'forumReplyCreate',
    'listingPublish',
    'reportCreate',
    'collectionUpsert',
  ] as const)('%s', async (name) => {
    const ip = '203.0.113.170';
    const { path, body } = calls[name];
    for (const user of [await createSignedUser(app), await createSignedUser(app)]) {
      for (let i = 0; i < 2; i += 1) {
        const res = await post(app, path, body(), ip, user.token);
        expect(res.status).toBe(200);
      }
      const over = await post(app, path, body(), ip, user.token);
      expect(over.status).toBe(429);
      expect(over.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
      expect(over.body.error.data.path).toBe(path);
    }
  });

  it('comments.create and comments.createForSeries share one user bucket', async () => {
    const a = await createSignedUser(app);
    const ip = '203.0.113.171';
    expect(
      (await post(app, 'comments.create', { cardSlug: commentCard, content: '一' }, ip, a.token))
        .status,
    ).toBe(200);
    expect(
      (
        await post(
          app,
          'comments.createForSeries',
          { seriesSlug: commentSeries, content: '二' },
          ip,
          a.token,
        )
      ).status,
    ).toBe(200);
    const over = await post(
      app,
      'comments.createForSeries',
      { seriesSlug: commentSeries, content: '三' },
      ip,
      a.token,
    );
    expect(over.status).toBe(429);
    expect(over.body.error.data.path).toBe('comments.createForSeries');
  });
});

describe('27-10: IP fallback', () => {
  it('throttles one IP on request N+1 without touching another IP or a user count', async () => {
    const prefix = testPrefix();
    const app = await createApp({
      rateLimitPrefix: prefix,
      ipRateLimitOverrides: { forumTopicCreate: { limit: 3, windowMs: 60_000 } },
    });
    await app.init();
    try {
      const body = { title: '帖', body: '正文' };
      const flood = '203.0.113.180';
      for (let i = 0; i < 3; i += 1) {
        const token = i % 2 === 0 ? undefined : 'not-a-jwt';
        expect((await post(app, 'forum.topics.create', body, flood, token)).status).toBe(401);
      }
      const capped = await post(app, 'forum.topics.create', body, flood);
      expect(capped.status).toBe(429);
      expect(capped.body).toEqual(tooManyBody('forum.topics.create'));

      const a = await createSignedUser(app);
      const key = `${userRateLimitStorePrefix('forumTopicCreate', prefix)}${a.id}`;
      const redis = app.get(RedisService).client;
      expect(await redis.get(key)).toBeNull();
      const other = await post(app, 'forum.topics.create', body, '203.0.113.181', a.token);
      expect(other.status).toBe(200);
      expect(await redis.get(key)).toBe('1');
      // A key always carries the window as its TTL.
      const ttl = await redis.pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60 * 60_000);
    } finally {
      await app.close();
    }
  });
});

describe('429 log lines name the layer (CH-227 §4)', () => {
  it('writes layer "user" for the user quota and layer "ip" for the IP fallback', async () => {
    const lines: string[] = [];
    const unsubscribe = subscribeLogLines((line) => {
      if (line.length > 0) lines.push(line);
    });
    const app = await createApp({
      rateLimitPrefix: testPrefix(),
      rateLimitOverrides: { forumTopicCreate: { limit: 1, windowMs: 60_000 } },
      ipRateLimitOverrides: { forumReplyCreate: { limit: 1, windowMs: 60_000 } },
    });
    await app.init();
    try {
      const a = await createSignedUser(app);
      const topic = { title: '帖', body: '正文' };
      expect((await post(app, 'forum.topics.create', topic, '203.0.113.190', a.token)).status).toBe(
        200,
      );
      expect((await post(app, 'forum.topics.create', topic, '203.0.113.190', a.token)).status).toBe(
        429,
      );
      const reply = { topicId: randomUUID(), body: '回帖' };
      expect((await post(app, 'forum.replies.create', reply, '203.0.113.191')).status).toBe(401);
      expect((await post(app, 'forum.replies.create', reply, '203.0.113.191')).status).toBe(429);

      const limited = lines
        .map((line): unknown => JSON.parse(line))
        .filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === 'object' &&
            entry !== null &&
            'message' in entry &&
            entry.message === 'rate limit exceeded',
        );
      expect(limited).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            layer: 'user',
            rateLimit: 'forumTopicCreate',
            totalHits: 2,
            limit: 1,
          }),
          expect.objectContaining({ layer: 'ip', rateLimit: 'forumReplyCreate' }),
        ]),
      );
    } finally {
      unsubscribe();
      await app.close();
    }
  });
});

describe('a context without the user limiter fails closed', () => {
  it('returns 500 with the public message and does not run the write', async () => {
    const app = await createApp({ rateLimitPrefix: testPrefix() });
    await app.init();
    try {
      const prisma = app.get(PrismaService);
      // Same router and context factory as createApp, minus the limiter.
      const server = express();
      server.use(express.json());
      server.use(
        '/trpc',
        trpcExpress.createExpressMiddleware({
          router: app.get(TrpcService).appRouter,
          createContext: makeCreateContext(app.get(AuthService), prisma),
        }),
      );
      const a = await createSignedUser(app);
      const res = await withProductionErrors(() =>
        request(server)
          .post('/trpc/forum.topics.create')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${a.token}`)
          .send({ title: '不该写入', body: '正文' }),
      );
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe(t('zh-CN', 'error.internal'));
      expect(res.body.error.data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error.data.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/rate limit|limiter|redis|node_modules/i);
      expect(await prisma.topic.count({ where: { userId: a.id } })).toBe(0);
    } finally {
      await app.close();
    }
  });
});
