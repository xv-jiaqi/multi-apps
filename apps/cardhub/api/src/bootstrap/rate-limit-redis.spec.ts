import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from './create-app';
import {
  RATE_LIMIT_KEY_PREFIX,
  rateLimitRedisErrorCount,
  rateLimitStorePrefix,
  userRateLimitStorePrefix,
} from './rate-limiters';
import { CatalogCache } from '../modules/redis/catalog-cache';
import { PrismaService } from '../modules/prisma/prisma.service';
import { RedisService } from '../modules/redis/redis.service';
import { createSignedUser } from '../../test/fixtures/signed-user';

/** Fails input validation (400) after the user layer has counted it. */
function postTopic(app: INestApplication, token: string, ip: string) {
  return request(app.getHttpServer())
    .post('/trpc/forum.topics.create')
    .set('Content-Type', 'application/json')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Forwarded-For', ip)
    .send({ title: '' });
}

async function close(app: INestApplication | undefined): Promise<void> {
  if (app) await app.close();
}

describe('Redis rate limit store', () => {
  it('gives every limiter its own production prefix', () => {
    expect(RATE_LIMIT_KEY_PREFIX).toBe('cardhub:rl:v1:');
    const prefixes = [
      rateLimitStorePrefix('authMutation', RATE_LIMIT_KEY_PREFIX),
      rateLimitStorePrefix('commentCreate', RATE_LIMIT_KEY_PREFIX),
      rateLimitStorePrefix('forumTopicCreate', RATE_LIMIT_KEY_PREFIX),
      rateLimitStorePrefix('forumReplyCreate', RATE_LIMIT_KEY_PREFIX),
      rateLimitStorePrefix('listingPublish', RATE_LIMIT_KEY_PREFIX),
      rateLimitStorePrefix('reportCreate', RATE_LIMIT_KEY_PREFIX),
      rateLimitStorePrefix('collectionUpsert', RATE_LIMIT_KEY_PREFIX),
    ];
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes[0]).toBe('cardhub:rl:v1:authMutation:');
  });

  it('shares a counter across two app instances', async () => {
    const prefix = `cardhub:rl:test:${randomUUID()}:`;
    const options = {
      rateLimitOverrides: { authMutation: { limit: 1, windowMs: 60_000 } },
      rateLimitPrefix: prefix,
    };
    const first = await createApp(options);
    const second = await createApp(options);
    await first.init();
    await second.init();
    try {
      await request(first.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.40')
        .expect((res) => expect(res.status).not.toBe(429));
      await request(second.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.40')
        .expect(429);

      await first.get(CatalogCache).invalidate({ kind: 'catalog' });
      await request(second.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.40')
        .expect(429);
    } finally {
      await close(first);
      await close(second);
    }
  });

  it('falls back to an in-process limit when Redis is down', async () => {
    const previousHost = process.env.REDIS_HOST;
    const previousPort = process.env.REDIS_PORT;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6390';
    let app: INestApplication | undefined;
    try {
      app = await createApp({
        rateLimitOverrides: { authMutation: { limit: 1, windowMs: 60_000 } },
        rateLimitPrefix: `cardhub:rl:test:${randomUUID()}:`,
      });
      await app.init();
      expect(app.get(RedisService).client.options.port).toBe(6390);
      const before = rateLimitRedisErrorCount();
      const first = await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.41');
      expect(first.status).toBeLessThan(500);
      expect(first.status).not.toBe(429);
      const second = await request(app.getHttpServer())
        .get('/trpc/auth.login')
        .set('X-Forwarded-For', '203.0.113.41');
      expect(second.status).toBe(429);
      const read = await request(app.getHttpServer()).get('/trpc/health.ping');
      expect(read.status).not.toBe(429);
      expect(read.status).toBeLessThan(500);
      expect(rateLimitRedisErrorCount()).toBeGreaterThan(before);
    } finally {
      await close(app);
      if (previousHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = previousHost;
      if (previousPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = previousPort;
    }
  });

  it('gives the user layer its own production prefix per limiter', () => {
    expect(userRateLimitStorePrefix('forumTopicCreate', RATE_LIMIT_KEY_PREFIX)).toBe(
      'cardhub:rl:v1:user:forumTopicCreate:',
    );
    expect(userRateLimitStorePrefix('commentCreate', RATE_LIMIT_KEY_PREFIX)).not.toBe(
      rateLimitStorePrefix('commentCreate', RATE_LIMIT_KEY_PREFIX),
    );
  });

  it('shares a user counter across two app instances', async () => {
    const prefix = `cardhub:rl:test:${randomUUID()}:`;
    const options = {
      rateLimitOverrides: { forumTopicCreate: { limit: 1, windowMs: 60_000 } },
      rateLimitPrefix: prefix,
    };
    const first = await createApp(options);
    const second = await createApp(options);
    await first.init();
    await second.init();
    try {
      const user = await createSignedUser(first);
      await postTopic(first, user.token, '203.0.113.42').expect(400);
      await postTopic(second, user.token, '203.0.113.43').expect(429);
    } finally {
      await close(first);
      await close(second);
    }
  });

  it('falls back to an in-process user limit when Redis is down', async () => {
    const previousHost = process.env.REDIS_HOST;
    const previousPort = process.env.REDIS_PORT;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6390';
    let app: INestApplication | undefined;
    try {
      app = await createApp({
        rateLimitOverrides: { forumTopicCreate: { limit: 1, windowMs: 60_000 } },
        rateLimitPrefix: `cardhub:rl:test:${randomUUID()}:`,
      });
      await app.init();
      expect(app.get(RedisService).client.options.port).toBe(6390);
      const user = await createSignedUser(app);
      const prisma = app.get(PrismaService);
      const before = rateLimitRedisErrorCount();
      const first = await postTopic(app, user.token, '203.0.113.44');
      expect(first.status).toBe(400);
      const second = await postTopic(app, user.token, '203.0.113.45');
      expect(second.status).toBe(429);
      expect(second.body.error.data.appCode).toBe('TOO_MANY_REQUESTS');
      expect(rateLimitRedisErrorCount()).toBeGreaterThan(before);

      // A valid write over the in-process limit is refused, not let through.
      const valid = await request(app.getHttpServer())
        .post('/trpc/forum.topics.create')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${user.token}`)
        .set('X-Forwarded-For', '203.0.113.46')
        .send({ title: '降级', body: '正文' });
      expect(valid.status).toBe(429);
      expect(valid.body.error.data.appCode).toBe('TOO_MANY_REQUESTS');
      expect(await prisma.topic.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      await close(app);
      if (previousHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = previousHost;
      if (previousPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = previousPort;
    }
  });
});
