import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { APP_ERROR_CODES, t } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import {
  isReportQuotaLockTimeout,
  lockReportQuota,
  REPORT_QUOTA_LOCK_NAMESPACE,
} from '../src/modules/reports/report-quota';
import { createSignedUser } from './fixtures/signed-user';

const TOO_MANY = t('zh-CN', 'error.app.TOO_MANY_REQUESTS');

/** One pooled connection, so a session-level advisory lock stays on it. */
function singleConnectionClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? '';
  const sep = url.includes('?') ? '&' : '?';
  return new PrismaClient({ datasources: { db: { url: `${url}${sep}connection_limit=1` } } });
}

/**
 * CH-231 on the real test Postgres: a report that cannot get its account's
 * quota lock within 3s is a 429 with Retry-After: 1, writes nothing, and
 * does not hold up other accounts.
 */
describe('reports quota lock wait has a 3s ceiling (CH-231)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let holder: PrismaClient;
  let topicId = '';

  beforeAll(async () => {
    app = await createApp({ rateLimitPrefix: `cardhub:rl:test:${randomUUID()}:` });
    await app.init();
    prisma = app.get(PrismaService);
    holder = singleConnectionClient();
    await holder.$connect();
    const owner = await createSignedUser(app);
    const topic = await prisma.topic.create({
      data: {
        slug: `ch231-${randomUUID().slice(0, 8)}`,
        title: '举报目标',
        body: '正文',
        userId: owner.id,
      },
    });
    topicId = topic.id;
  });

  afterAll(async () => {
    await holder?.$disconnect();
    await app?.close();
  });

  /** What a psql session holding the lock does (31-1): pg_advisory_lock on the same keys. */
  async function holdLock(reporterId: string): Promise<() => Promise<void>> {
    await holder.$queryRaw`SELECT pg_advisory_lock(${REPORT_QUOTA_LOCK_NAMESPACE}::int4, hashtext(${reporterId}))::text`;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await holder.$queryRaw`SELECT pg_advisory_unlock(${REPORT_QUOTA_LOCK_NAMESPACE}::int4, hashtext(${reporterId}))::text`;
    };
    // Old code waits for the lock forever; let go so the test fails instead of hanging.
    setTimeout(() => void release(), 8_000).unref();
    return release;
  }

  function report(token: string, ip: string) {
    return request(app.getHttpServer())
      .post('/trpc/reports.create')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip)
      .set('Authorization', `Bearer ${token}`)
      .send({ targetType: 'TOPIC', targetId: topicId, reason: '广告内容' });
  }

  async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const started = Date.now();
    const value = await run();
    return { value, ms: Date.now() - started };
  }

  it('231-C: Postgres 55P03 reaches the code as P2010 with meta.code 55P03, and the matcher accepts it', async () => {
    const a = await createSignedUser(app);
    const release = await holdLock(a.id);
    try {
      const error = await prisma
        .$transaction((tx) => lockReportQuota(tx, a.id))
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(error).toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
      expect(isReportQuotaLockTimeout(error)).toBe(true);
    } finally {
      await release();
    }
  });

  it('31-1/31-2: held lock → ~3s 429 with Retry-After 1 and no row; other account unaffected; after release it succeeds', async () => {
    const a = await createSignedUser(app);
    const b = await createSignedUser(app);
    const before = await prisma.report.count({ where: { reporterId: a.id } });
    const release = await holdLock(a.id);

    const blocked = timed(() => report(a.token, '203.0.113.240'));
    // B reports while A is still waiting.
    const other = await timed(() => report(b.token, '203.0.113.241'));
    expect(other.value.status).toBe(200);
    expect(other.ms).toBeLessThan(1_000);

    const { value: res, ms } = await blocked;
    process.stdout.write(`CH-231 lock wait 429 after ${ms} ms\n`);
    expect(ms).toBeGreaterThanOrEqual(2_900);
    expect(ms).toBeLessThan(5_000);
    expect(res.status).toBe(429);
    expect(res.body.error.message).toBe(TOO_MANY);
    expect(res.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.headers['ratelimit']).toBeUndefined();
    expect(res.headers['ratelimit-policy']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/55P03|P2010|lock timeout|prisma/i);
    expect(await prisma.report.count({ where: { reporterId: a.id } })).toBe(before);

    await release();
    const after = await report(a.token, '203.0.113.240');
    expect(after.status).toBe(200);
    expect(await prisma.report.count({ where: { reporterId: a.id } })).toBe(before + 1);
  }, 20_000);
});
