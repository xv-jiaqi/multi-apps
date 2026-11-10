import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { createSignedUser } from './fixtures/signed-user';

const DAY_MS = 24 * 60 * 60 * 1000;
const QUOTA_MESSAGE = '今日举报次数已达上限，请明天再试';

type HeaderBag = Record<string, string | string[] | undefined>;

function retryAfter(headers: HeaderBag): number | undefined {
  const value = headers['retry-after'];
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function expectNoIpQuotaHeaders(headers: HeaderBag) {
  expect(headers['ratelimit']).toBeUndefined();
  expect(headers['ratelimit-policy']).toBeUndefined();
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

describe('reports daily quota 429 headers (CH-229)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let topicId = '';

  beforeAll(async () => {
    app = await createApp({
      rateLimitPrefix: `cardhub:rl:test:${randomUUID()}:`,
      // Lets the batch case put a user-layer rejection next to the quota one.
      rateLimitOverrides: { forumTopicCreate: { limit: 1, windowMs: 60 * 60_000 } },
    });
    await app.init();
    prisma = app.get(PrismaService);
    const owner = await createSignedUser(app);
    const topic = await prisma.topic.create({
      data: {
        slug: `ch229-${randomUUID().slice(0, 8)}`,
        title: '举报目标',
        body: '正文',
        userId: owner.id,
      },
    });
    topicId = topic.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Ten reports in the last 24h; the oldest is `oldestAgeMs` old. Written straight to the test DB. */
  async function fillQuota(reporterId: string, oldestAgeMs: number): Promise<Date> {
    const now = Date.now();
    const oldest = new Date(now - oldestAgeMs);
    await prisma.report.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        reporterId,
        targetType: 'TOPIC' as const,
        targetId: topicId,
        reason: '测试举报',
        createdAt: i === 0 ? oldest : new Date(now - 60_000 + i),
      })),
    });
    return oldest;
  }

  function call(path: string, body: unknown, ip: string, token: string) {
    return request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  const report = () => ({ targetType: 'TOPIC', targetId: topicId, reason: '广告内容' });

  it('29-2: a report under the quota keeps the IP layer headers and has no Retry-After', async () => {
    const a = await createSignedUser(app);
    const res = await call('reports.create', report(), '203.0.113.210', a.token);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toEqual(expect.any(String));
    expect(res.headers['ratelimit-policy']).toEqual(expect.any(String));
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('29-1: the 11th report is 429 with Retry-After = oldest + 24h − now and no RateLimit*', async () => {
    const a = await createSignedUser(app);
    const oldest = await fillQuota(a.id, 60 * 60_000);
    const res = await withProductionErrors(() =>
      call('reports.create', report(), '203.0.113.211', a.token),
    );
    const expected = Math.ceil((oldest.getTime() + DAY_MS - Date.now()) / 1000);
    expect(res.status).toBe(429);
    expect(res.body.error.message).toBe(QUOTA_MESSAGE);
    expect(res.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
    expect(JSON.stringify(res.body)).not.toMatch(/reportQuota|retryAfter|stack|prisma/i);
    const seconds = retryAfter(res.headers);
    expect(seconds).toBeDefined();
    expect(Math.abs((seconds ?? 0) - expected)).toBeLessThanOrEqual(5);
    expectNoIpQuotaHeaders(res.headers);
    expect(await prisma.report.count({ where: { reporterId: a.id } })).toBe(10);
  });

  it('229-B: a batch with a quota rejection and a success is 207 with Retry-After and no RateLimit*', async () => {
    const a = await createSignedUser(app);
    await fillQuota(a.id, 60 * 60_000);
    const res = await withProductionErrors(() =>
      call(
        'forum.topics.create,reports.create?batch=1',
        { 0: { title: '能发', body: '正文' }, 1: report() },
        '203.0.113.212',
        a.token,
      ),
    );
    expect(res.status).toBe(207);
    expect(res.body[0].result.data.title).toBe('能发');
    expect(res.body[1].error.message).toBe(QUOTA_MESSAGE);
    expect(res.body[1].error.data.httpStatus).toBe(429);
    const seconds = retryAfter(res.headers);
    expect(seconds).toBeGreaterThan(23 * 3600 - 10);
    expect(seconds).toBeLessThanOrEqual(23 * 3600);
    expectNoIpQuotaHeaders(res.headers);
  });

  it('229-B: mixed with a user-layer rejection, Retry-After is the larger of the two', async () => {
    // Quota wait ~30s, user-layer wait ~1h.
    const shortQuota = await createSignedUser(app);
    await fillQuota(shortQuota.id, DAY_MS - 30_000);
    expect(
      (
        await call(
          'forum.topics.create',
          { title: '一', body: '正文' },
          '203.0.113.213',
          shortQuota.token,
        )
      ).status,
    ).toBe(200);
    const userLonger = await call(
      'reports.create,forum.topics.create?batch=1',
      { 0: report(), 1: { title: '二', body: '正文' } },
      '203.0.113.213',
      shortQuota.token,
    );
    expect(userLonger.status).toBe(429);
    expect(retryAfter(userLonger.headers)).toBeGreaterThan(3500);
    expect(retryAfter(userLonger.headers)).toBeLessThanOrEqual(3600);
    expectNoIpQuotaHeaders(userLonger.headers);

    // Quota wait ~23h, user-layer wait ~1h.
    const longQuota = await createSignedUser(app);
    await fillQuota(longQuota.id, 60 * 60_000);
    expect(
      (
        await call(
          'forum.topics.create',
          { title: '一', body: '正文' },
          '203.0.113.214',
          longQuota.token,
        )
      ).status,
    ).toBe(200);
    const quotaLonger = await call(
      'forum.topics.create,reports.create?batch=1',
      { 0: { title: '二', body: '正文' }, 1: report() },
      '203.0.113.214',
      longQuota.token,
    );
    expect(quotaLonger.status).toBe(429);
    expect(retryAfter(quotaLonger.headers)).toBeGreaterThan(23 * 3600 - 10);
    expectNoIpQuotaHeaders(quotaLonger.headers);
  });
});
