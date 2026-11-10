import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { lockReportQuota } from '../src/modules/reports/report-quota';
import { createSignedUser } from './fixtures/signed-user';

const QUOTA_MESSAGE = '今日举报次数已达上限，请明天再试';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * CH-230 230-A/C on the real test Postgres: the quota count and the insert
 * are one atomic step per account, and accounts do not wait on each other.
 */
describe('reports daily quota under concurrency (CH-230)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let topicId = '';

  beforeAll(async () => {
    app = await createApp({ rateLimitPrefix: `cardhub:rl:test:${randomUUID()}:` });
    await app.init();
    prisma = app.get(PrismaService);
    const owner = await createSignedUser(app);
    const topic = await prisma.topic.create({
      data: {
        slug: `ch230-${randomUUID().slice(0, 8)}`,
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

  /** `count` reports inside the window, written straight to the test DB. */
  async function seedReports(reporterId: string, count: number): Promise<void> {
    const now = Date.now();
    await prisma.report.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        reporterId,
        targetType: 'TOPIC' as const,
        targetId: topicId,
        reason: '测试举报',
        createdAt: new Date(now - 60 * 60_000 + i),
      })),
    });
  }

  function report(token: string, ip: string) {
    return request(app.getHttpServer())
      .post('/trpc/reports.create')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${token}`)
      .send({ targetType: 'TOPIC', targetId: topicId, reason: '广告内容' });
  }

  function windowCount(reporterId: string) {
    return prisma.report.count({
      where: { reporterId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
  }

  it.each([1, 2, 3])(
    '230-C round %i: 9 reports, then 5 at once → exactly 1 succeeds, 4 get the quota 429',
    async (round) => {
      const a = await createSignedUser(app);
      await seedReports(a.id, 9);
      const ip = `203.0.113.${220 + round}`;
      const responses = await Promise.all(Array.from({ length: 5 }, () => report(a.token, ip)));
      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([200, 429, 429, 429, 429]);
      for (const res of responses.filter((r) => r.status === 429)) {
        expect(res.body.error.message).toBe(QUOTA_MESSAGE);
        expect(res.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
        // CH-229 headers are unchanged: the oldest seeded report is ~1h old.
        const retryAfter = Number(res.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(23 * 3600 - 60);
        expect(retryAfter).toBeLessThanOrEqual(23 * 3600);
        expect(res.headers['ratelimit']).toBeUndefined();
        expect(res.headers['ratelimit-policy']).toBeUndefined();
      }
      expect(await windowCount(a.id)).toBe(10);
    },
  );

  it('230-A: while one account waits on its own quota lock, another account reports right away', async () => {
    const a = await createSignedUser(app);
    const b = await createSignedUser(app);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const isHeld = new Promise<void>((resolve) => {
      held = resolve;
    });
    // Another session holds A's quota lock, as an in-flight report from A would.
    const holder = prisma.$transaction(
      async (tx) => {
        await lockReportQuota(tx, a.id);
        held();
        await released;
      },
      { timeout: 15_000 },
    );
    await isHeld;

    let aSettled = false;
    const aReport = report(a.token, '203.0.113.231').then((res) => {
      aSettled = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(aSettled).toBe(false);

    const started = Date.now();
    const bRes = await report(b.token, '203.0.113.232');
    const bMs = Date.now() - started;
    expect(bRes.status).toBe(200);
    expect(bMs).toBeLessThan(1_000);
    expect(aSettled).toBe(false);

    release();
    await holder;
    const aRes = await aReport;
    expect(aRes.status).toBe(200);
    expect(await windowCount(a.id)).toBe(1);
    expect(await windowCount(b.id)).toBe(1);
  });
});
