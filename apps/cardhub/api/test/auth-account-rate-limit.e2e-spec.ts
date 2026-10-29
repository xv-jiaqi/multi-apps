import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_ERROR_CODES } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { productionRateLimitConfigs, TRPC_MAX_BATCH_SIZE } from '../src/bootstrap/rate-limiters';
import { hashPassword } from '../src/modules/auth/password-hash';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';

const LOGIN_LIMIT = productionRateLimitConfigs.authMutation.limit;

function emailForAttempt(attempt: number): string {
  const canonical = 'rotate.user@cardhub.test';
  return attempt % 2 === 0 ? `  ${canonical.toUpperCase()}  ` : canonical;
}

function clientIp(octet: number): string {
  return `192.0.2.${octet}`;
}

function headerText(response: request.Response, name: string): string {
  const raw = response.headers[name];
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof value !== 'string') {
    throw new Error(`missing ${name}: ${JSON.stringify(response.headers)}`);
  }
  return value;
}

function remaining(response: request.Response): number {
  const matches = [...headerText(response, 'ratelimit').matchAll(/remaining=(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  if (matches.length === 0 || matches.some((value) => !Number.isFinite(value))) {
    throw new Error(`missing ratelimit remaining: ${JSON.stringify(response.headers)}`);
  }
  return Math.min(...matches);
}

function limitHeaders(response: request.Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, raw] of Object.entries(response.headers)) {
    if (!/ratelimit|retry-after/i.test(name)) continue;
    headers[name] = Array.isArray(raw) ? raw.join(',') : String(raw);
  }
  return headers;
}

const BAD_REQUEST = {
  error: {
    message: '请求无效，请检查后再试',
    code: -32600,
    data: {
      code: 'BAD_REQUEST',
      appCode: APP_ERROR_CODES.BAD_REQUEST,
      httpStatus: 400,
    },
  },
};

const LOGIN_BLOCKED = {
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
};

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
    const prefix = `cardhub:rl:test:${randomUUID()}:`;
    const app = await createApp({ rateLimitPrefix: prefix });
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
      expect(blocked.body).toEqual(LOGIN_BLOCKED);
      expect(headerText(blocked, 'ratelimit-policy')).toBe(`${LOGIN_LIMIT};w=60`);
      expect(headerText(blocked, 'retry-after')).toMatch(/^\d+$/);
      expect(JSON.stringify(blocked.body).toLowerCase()).not.toContain('rotate.user');
      const keys = await app.get(RedisService).client.keys(`${prefix}authAccount:*`);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((key) => /authAccount:[0-9a-f]{64}$/.test(key))).toBe(true);
      expect(keys.join('\n').toLowerCase()).not.toContain('rotate.user');
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
        const response = await postLogin(app, 'offline.user@cardhub.test', clientIp(attempt + 20));
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

  it('clears the account counter after a successful login', async () => {
    const app = await createApp();
    await app.init();
    const prisma = app.get(PrismaService);
    const suffix = randomUUID().slice(0, 8);
    const email = `clear.${suffix}@cardhub.test`;
    const other = `other.${suffix}@cardhub.test`;
    const password = 'correct-password';
    try {
      await prisma.user.create({
        data: {
          email,
          username: `clr${suffix}`,
          password: await hashPassword(password),
        },
      });

      const otherFirst = await postLogin(app, other, clientIp(70));
      expect(otherFirst.status).not.toBe(429);
      expect(remaining(otherFirst)).toBe(LOGIN_LIMIT - 1);

      for (let attempt = 0; attempt < LOGIN_LIMIT - 1; attempt += 1) {
        const response = await postLogin(
          app,
          attempt % 2 === 0 ? `  ${email.toUpperCase()}  ` : email,
          clientIp(80 + attempt),
        );
        expect(response.status).not.toBe(429);
      }

      const signedIn = await request(app.getHttpServer())
        .post('/trpc/auth.login')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(100))
        .send({ identifier: `  ${email.toUpperCase()}  `, password });
      expect(signedIn.status).toBe(200);

      const otherSecond = await postLogin(app, other, clientIp(71));
      expect(otherSecond.status).not.toBe(429);
      expect(remaining(otherSecond)).toBe(LOGIN_LIMIT - 2);

      const firstAfter = await postLogin(app, email, clientIp(101));
      expect(firstAfter.status).not.toBe(429);
      expect(remaining(firstAfter)).toBe(LOGIN_LIMIT - 1);

      for (let attempt = 1; attempt < LOGIN_LIMIT; attempt += 1) {
        const response = await postLogin(app, email, clientIp(101 + attempt));
        expect(response.status).not.toBe(429);
      }
      const blocked = await postLogin(app, email, clientIp(120));
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual(LOGIN_BLOCKED);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
      await close(app);
    }
  });

  it('returns the same 429 body and headers for an existing account and a missing account', async () => {
    const prefix = `cardhub:rl:test:${randomUUID()}:`;
    const app = await createApp({ rateLimitPrefix: prefix });
    await app.init();
    const prisma = app.get(PrismaService);
    const suffix = randomUUID().slice(0, 8);
    const existing = `exists.${suffix}@cardhub.test`;
    const missing = `missing.${suffix}@cardhub.test`;
    try {
      await prisma.user.create({
        data: {
          email: existing,
          username: `ex${suffix}`,
          password: await hashPassword('correct-password'),
        },
      });

      let existingBlocked: request.Response | undefined;
      let missingBlocked: request.Response | undefined;
      for (let attempt = 0; attempt <= LOGIN_LIMIT; attempt += 1) {
        const existingEmail = attempt % 2 === 0 ? `  ${existing.toUpperCase()}  ` : existing;
        const missingEmail = attempt % 2 === 0 ? `  ${missing.toUpperCase()}  ` : missing;
        const [left, right] = await Promise.all([
          postLogin(app, existingEmail, clientIp(130 + attempt)),
          postLogin(app, missingEmail, clientIp(160 + attempt)),
        ]);
        if (attempt < LOGIN_LIMIT) {
          expect(left.status).not.toBe(429);
          expect(right.status).not.toBe(429);
          continue;
        }
        existingBlocked = left;
        missingBlocked = right;
      }

      expect(existingBlocked?.status).toBe(429);
      expect(missingBlocked?.status).toBe(429);
      expect(existingBlocked?.body).toEqual(LOGIN_BLOCKED);
      expect(missingBlocked?.body).toEqual(existingBlocked?.body);
      expect(limitHeaders(existingBlocked!)).toEqual(limitHeaders(missingBlocked!));
      expect(headerText(existingBlocked!, 'ratelimit-policy')).toBe(`${LOGIN_LIMIT};w=60`);
      expect(headerText(existingBlocked!, 'ratelimit')).toContain('remaining=0');
      expect(headerText(existingBlocked!, 'retry-after')).toMatch(/^\d+$/);
      const bodyText = `${JSON.stringify(existingBlocked?.body)}${JSON.stringify(missingBlocked?.body)}`;
      expect(bodyText.toLowerCase()).not.toContain(`exists.${suffix}`);
      expect(bodyText.toLowerCase()).not.toContain(`missing.${suffix}`);
      const headerTextJoined = JSON.stringify(limitHeaders(existingBlocked!)).toLowerCase();
      expect(headerTextJoined).not.toContain(`exists.${suffix}`);
      expect(headerTextJoined).not.toContain(`missing.${suffix}`);

      const keys = await app.get(RedisService).client.keys(`${prefix}authAccount:*`);
      expect(keys.join('\n').toLowerCase()).not.toContain(`exists.${suffix}`);
      expect(keys.join('\n').toLowerCase()).not.toContain(`missing.${suffix}`);
    } finally {
      await prisma.user.deleteMany({ where: { email: existing } });
      await close(app);
    }
  });

  it('counts the tRPC batch login body used by the web client', async () => {
    const app = await createApp({
      rateLimitOverrides: { authMutation: { limit: 2, windowMs: 60_000 } },
    });
    await app.init();
    const email = `batch.${randomUUID().slice(0, 8)}@cardhub.test`;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await request(app.getHttpServer())
          .post('/trpc/health.ping,auth.login?batch=1')
          .set('Content-Type', 'application/json')
          .set('X-Forwarded-For', clientIp(200 + attempt))
          .send({
            0: { ping: true },
            1: {
              identifier: attempt === 0 ? `  ${email.toUpperCase()}  ` : email,
              password: 'not-the-password',
            },
          });
        expect(response.status).not.toBe(429);
      }

      const blocked = await request(app.getHttpServer())
        .post('/trpc/health.ping,auth.login?batch=1')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(210))
        .send({ 0: { ping: true }, 1: { identifier: email, password: 'not-the-password' } });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual([
        {
          error: {
            message: '操作太频繁，请稍后再试',
            code: -32029,
            data: {
              code: 'TOO_MANY_REQUESTS',
              appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
              httpStatus: 429,
              path: 'health.ping',
            },
          },
        },
        {
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
        },
      ]);
      expect(JSON.stringify(blocked.body).toLowerCase()).not.toContain(email.split('@')[0]);
    } finally {
      await close(app);
    }
  });

  it('rejects a multi-login batch before login runs and still limits later single attempts', async () => {
    const app = await createApp();
    await app.init();
    const prisma = app.get(PrismaService);
    const suffix = randomUUID().slice(0, 8);
    const email = `slots.${suffix}@cardhub.test`;
    const password = 'correct-password';
    const slots = Array.from({ length: 11 }, () => 'auth.login').join(',');
    const body: Record<string, { identifier: string; password: string }> = {};
    for (let index = 0; index < 11; index += 1) {
      body[String(index)] = { identifier: email, password };
    }
    try {
      await prisma.user.create({
        data: {
          email,
          username: `slt${suffix}`,
          password: await hashPassword(password),
        },
      });

      const rejected = await request(app.getHttpServer())
        .post(`/trpc/${slots}?batch=1`)
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(220))
        .send(body);
      expect(rejected.status).toBe(400);
      expect(rejected.body).toEqual(BAD_REQUEST);
      expect(Array.isArray(rejected.body)).toBe(false);
      expect(JSON.stringify(rejected.body)).not.toContain('token');

      const encodedPair = await request(app.getHttpServer())
        .post('/trpc/auth.login%2Cauth.login?batch=1')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(221))
        .send({
          0: { identifier: email, password },
          1: { identifier: email, password },
        });
      expect(encodedPair.status).toBe(400);
      expect(encodedPair.body).toEqual(BAD_REQUEST);
      expect(JSON.stringify(encodedPair.body)).not.toContain('token');

      let previous = LOGIN_LIMIT;
      for (let attempt = 0; attempt < LOGIN_LIMIT; attempt += 1) {
        const response = await postLogin(app, email, clientIp(222 + attempt));
        expect(response.status).not.toBe(429);
        const left = remaining(response);
        expect(left).toBe(previous - 1);
        previous = left;
      }
      const blocked = await postLogin(app, email, clientIp(240));
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual(LOGIN_BLOCKED);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
      await close(app);
    }
  });

  it('returns 400 above maxBatchSize and still counts a one-slot login batch', async () => {
    const app = await createApp({
      rateLimitOverrides: { authMutation: { limit: 2, windowMs: 60_000 } },
    });
    await app.init();
    const email = `one.${randomUUID().slice(0, 8)}@cardhub.test`;
    try {
      const atCap = Array.from({ length: TRPC_MAX_BATCH_SIZE }, () => 'health.ping').join(',');
      const allowed = await request(app.getHttpServer()).get(`/trpc/${atCap}?batch=1`);
      expect(allowed.status).not.toBe(400);
      expect(Array.isArray(allowed.body)).toBe(true);
      expect(allowed.body).toHaveLength(TRPC_MAX_BATCH_SIZE);

      const over = Array.from({ length: TRPC_MAX_BATCH_SIZE + 1 }, () => 'health.ping').join(',');
      const rejected = await request(app.getHttpServer()).get(`/trpc/${over}?batch=1`);
      expect(rejected.status).toBe(400);
      expect(rejected.body).toEqual(BAD_REQUEST);
      expect(JSON.stringify(rejected.body)).not.toContain('maximum size');

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await request(app.getHttpServer())
          .post('/trpc/auth.login?batch=1')
          .set('Content-Type', 'application/json')
          .set('X-Forwarded-For', clientIp(250 + attempt))
          .send({ 0: { identifier: email, password: 'not-the-password' } });
        expect(response.status).not.toBe(429);
      }
      const blocked = await request(app.getHttpServer())
        .post('/trpc/auth.login?batch=1')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(252))
        .send({ 0: { identifier: email, password: 'not-the-password' } });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual([LOGIN_BLOCKED]);
    } finally {
      await close(app);
    }
  });

  it('counts percent-encoded login paths and ignores variants tRPC does not route', async () => {
    const app = await createApp();
    await app.init();
    const email = `enc.${randomUUID().slice(0, 8)}@cardhub.test`;
    try {
      const malformed = await request(app.getHttpServer())
        .post('/trpc/%E0%A4%A')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(1))
        .send({ identifier: email, password: 'not-the-password' });
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(BAD_REQUEST);

      const wrongCase = await request(app.getHttpServer())
        .post('/trpc/Auth.Login')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(2))
        .send({ identifier: email, password: 'not-the-password' });
      expect(wrongCase.status).not.toBe(401);
      expect(wrongCase.status).not.toBe(429);

      const doubleEncoded = await request(app.getHttpServer())
        .post('/trpc/auth%252Elogin')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(3))
        .send({ identifier: email, password: 'not-the-password' });
      expect(doubleEncoded.status).not.toBe(401);
      expect(doubleEncoded.status).not.toBe(429);

      let previous = LOGIN_LIMIT;
      for (let attempt = 0; attempt < LOGIN_LIMIT; attempt += 1) {
        const path = attempt % 2 === 0 ? '/trpc/auth%2Elogin' : '/trpc/auth%2elogin';
        const response = await request(app.getHttpServer())
          .post(path)
          .set('Content-Type', 'application/json')
          .set('X-Forwarded-For', clientIp(10 + attempt))
          .send({
            identifier: attempt % 2 === 0 ? `  ${email.toUpperCase()}  ` : email,
            password: 'not-the-password',
          });
        expect(response.status).not.toBe(429);
        const left = remaining(response);
        expect(left).toBe(previous - 1);
        previous = left;
      }

      const blocked = await request(app.getHttpServer())
        .post('/trpc/auth%2Elogin')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', clientIp(30))
        .send({ identifier: email, password: 'not-the-password' });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual(LOGIN_BLOCKED);
    } finally {
      await close(app);
    }
  });
});
