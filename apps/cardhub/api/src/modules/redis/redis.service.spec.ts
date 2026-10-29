import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RedisService } from './redis.service';

const payloadSchema = z.object({ name: z.string() });

describe('RedisService.getOrSet', () => {
  const keys: string[] = [];

  function key(label: string): string {
    const value = `cardhub:cache:v1:unit:${label}:${randomUUID()}`;
    keys.push(value);
    return value;
  }

  afterAll(async () => {
    const redis = new RedisService(RedisService.createClient(new ConfigService({})));
    await redis.onModuleInit();
    await redis.deleteKeys(keys);
    redis.client.disconnect();
  });

  it('loads once, then serves the cached payload without calling the loader', async () => {
    const redis = new RedisService(RedisService.createClient(new ConfigService({})));
    await redis.onModuleInit();
    const cacheKey = key('hit');
    let calls = 0;
    const loader = () => {
      calls += 1;
      return Promise.resolve({ name: '极光骑士' });
    };

    await expect(redis.getOrSet(cacheKey, 300, payloadSchema, loader)).resolves.toEqual({
      name: '极光骑士',
    });
    await expect(redis.getOrSet(cacheKey, 300, payloadSchema, loader)).resolves.toEqual({
      name: '极光骑士',
    });
    expect(calls).toBe(1);

    const ttl = await redis.client.ttl(cacheKey);
    expect(ttl).toBeGreaterThan(240);
    expect(ttl).toBeLessThanOrEqual(300);
    redis.client.disconnect();
  });

  it('does not cache a loader failure', async () => {
    const redis = new RedisService(RedisService.createClient(new ConfigService({})));
    await redis.onModuleInit();
    const cacheKey = key('throw');
    let calls = 0;
    const loader = () => {
      calls += 1;
      return Promise.reject(new Error('数据库暂时失败'));
    };

    await expect(redis.getOrSet(cacheKey, 300, payloadSchema, loader)).rejects.toThrow(
      '数据库暂时失败',
    );
    await expect(redis.getOrSet(cacheKey, 300, payloadSchema, loader)).rejects.toThrow(
      '数据库暂时失败',
    );
    expect(calls).toBe(2);
    expect(await redis.client.get(cacheKey)).toBeNull();
    redis.client.disconnect();
  });

  it('ignores a corrupt cache entry and replaces it', async () => {
    const redis = new RedisService(RedisService.createClient(new ConfigService({})));
    await redis.onModuleInit();
    const cacheKey = key('corrupt');
    await redis.client.set(cacheKey, '{', 'EX', 300);
    let calls = 0;

    await expect(
      redis.getOrSet(cacheKey, 300, payloadSchema, () => {
        calls += 1;
        return Promise.resolve({ name: '修好了' });
      }),
    ).resolves.toEqual({ name: '修好了' });
    expect(calls).toBe(1);
    expect(await redis.client.get(cacheKey)).toBe(JSON.stringify({ name: '修好了' }));
    redis.client.disconnect();
  });

  it('calls the loader and still resolves when Redis is down', async () => {
    const previousHost = process.env.REDIS_HOST;
    const previousPort = process.env.REDIS_PORT;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6390';
    const redis = new RedisService(RedisService.createClient(new ConfigService({})));
    expect(redis.client.options.port).toBe(6390);
    const started = Date.now();
    try {
      await redis.onModuleInit();
      expect(Date.now() - started).toBeLessThan(2_000);

      let calls = 0;
      await expect(
        redis.getOrSet(key('down'), 300, payloadSchema, () => {
          calls += 1;
          return Promise.resolve({ name: '直接查库' });
        }),
      ).resolves.toEqual({ name: '直接查库' });
      await expect(
        redis.getOrSet(key('down-again'), 300, payloadSchema, () => {
          calls += 1;
          return Promise.resolve({ name: '再次查库' });
        }),
      ).resolves.toEqual({ name: '再次查库' });
      expect(calls).toBe(2);
    } finally {
      redis.client.disconnect();
      if (previousHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = previousHost;
      if (previousPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = previousPort;
    }
  });

  it('deletes keys by prefix and leaves unrelated keys in place', async () => {
    const redis = new RedisService(RedisService.createClient(new ConfigService({})));
    await redis.onModuleInit();
    const prefix = `cardhub:cache:v1:unit-prefix:${randomUUID()}:`;
    const kept = `cardhub:rl:v1:unit:${randomUUID()}`;
    keys.push(`${prefix}cards.bySlug:one`, `${prefix}series.list:page=1`, kept);
    await redis.client.set(`${prefix}cards.bySlug:one`, '1');
    await redis.client.set(`${prefix}series.list:page=1`, '1');
    await redis.client.set(kept, 'keep');

    await redis.deleteByPrefix(prefix);

    expect(await redis.client.get(`${prefix}cards.bySlug:one`)).toBeNull();
    expect(await redis.client.get(`${prefix}series.list:page=1`)).toBeNull();
    expect(await redis.client.get(kept)).toBe('keep');
    await redis.deleteKeys([kept]);
    redis.client.disconnect();
  });
});
