import type { INestApplication } from '@nestjs/common';
import { APP_ERROR_CODES } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { productionRateLimitConfigs } from '../src/bootstrap/rate-limiters';
import { RedisService } from '../src/modules/redis/redis.service';

const LOGIN_LIMIT = productionRateLimitConfigs.authMutation.limit;

function emailForAttempt(attempt: number): string {
  const canonical = 'rotate.user@cardhub.test';
  return attempt % 2 === 0 ? `  ${canonical.toUpperCase()}  ` : canonical;
}

function clientIp(octet: number): string {
  return `192.0.2.${octet}`;
}

function remaining(response: request.Response): number {
  const raw = response.headers.ratelimit;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = typeof value === 'string' ? /remaining=(\d+)/.exec(value) : null;
  const parsed = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`missing ratelimit remaining: ${JSON.stringify(response.headers)}`);
  }
  return parsed;
}

function postLogin(app: INestApplication, email: string, ip: string) {
  return request(app.getHttpServer())
    .post('/trpc/auth.login')
    .set('Content-Type', 'application/json')
    .set('X-Forwarded-For', ip)
    .send({ identifier: email, password: 'not-the-password' });
}

async function close(app: INestApplication | undefined): Promise<void> {
  if (app) await app.close();
}

describe('auth account rate limit', () => {
  jest.setTimeout(60_000);

  it('returns 429 for one email when every attempt comes from a new client IP', async () => {
    const app = await createApp();
    await app.init();
    try {
      let previous = LOGIN_LIMIT;
      for (let attempt = 0; attempt < LOGIN_LIMIT; attempt += 1) {
        const response = await postLogin(app, emailForAttempt(attempt), clientIp(attempt + 1));
        expect(response.status).not.toBe(429);
        const left = remaining(response);
        expect(left).toBe(previous - 1);
        previous = left;
        expect(JSON.stringify(response.body).toLowerCase()).not.toContain('rotate.user');
      }

      const blocked = await postLogin(app, 'rotate.user@cardhub.test', clientIp(LOGIN_LIMIT + 1));
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({
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
      expect(JSON.stringify(blocked.body).toLowerCase()).not.toContain('rotate.user');
    } finally {
      await close(app);
    }
  });

  it('returns 429 after the login limit when Redis is not responding', async () => {
    const previousHost = process.env.REDIS_HOST;
    const previousPort = process.env.REDIS_PORT;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6391';
    let app: INestApplication | undefined;
    try {
      app = await createApp();
      await app.init();
      let previous = LOGIN_LIMIT;
      for (let attempt = 0; attempt < LOGIN_LIMIT; attempt += 1) {
        const response = await postLogin(
          app,
          'offline.user@cardhub.test',
          clientIp(attempt + 20),
        );
        expect(response.status).not.toBe(429);
        const left = remaining(response);
        expect(left).toBe(previous - 1);
        previous = left;
      }

      const blocked = await postLogin(app, 'offline.user@cardhub.test', clientIp(40));
      expect(blocked.status).toBe(429);

      const read = await request(app.getHttpServer()).get('/trpc/health.ping');
      expect(read.status).not.toBe(429);
      expect(read.status).toBeLessThan(500);
    } finally {
      await close(app);
      if (previousHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = previousHost;
      if (previousPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = previousPort;
    }
  });

  it('keeps counting after SCRIPT FLUSH', async () => {
    const app = await createApp();
    await app.init();
    try {
      const first = await postLogin(app, 'flush.user@cardhub.test', clientIp(50));
      expect(first.status).not.toBe(429);
      expect(remaining(first)).toBe(LOGIN_LIMIT - 1);

      await app.get(RedisService).client.call('SCRIPT', 'FLUSH');

      const second = await postLogin(app, 'flush.user@cardhub.test', clientIp(50));
      expect(second.status).not.toBe(429);
      expect(remaining(second)).toBe(LOGIN_LIMIT - 2);
    } finally {
      await close(app);
    }
  });
});
