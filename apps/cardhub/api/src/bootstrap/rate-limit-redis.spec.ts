import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from './create-app';
import { RATE_LIMIT_KEY_PREFIX, rateLimitStorePrefix } from './rate-limiters';
import { CatalogCache } from '../modules/redis/catalog-cache';
import { RedisService } from '../modules/redis/redis.service';

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

  it('lets rate-limited routes through when Redis is down', async () => {
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
      for (let i = 0; i < 3; i += 1) {
        const response = await request(app.getHttpServer())
          .get('/trpc/auth.login')
          .set('X-Forwarded-For', '203.0.113.41');
        expect(response.status).toBeLessThan(500);
        expect(response.status).not.toBe(429);
      }
    } finally {
      await close(app);
      if (previousHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = previousHost;
      if (previousPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = previousPort;
    }
  });
});
