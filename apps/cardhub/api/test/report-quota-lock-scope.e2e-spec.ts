import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { lockReportQuota } from '../src/modules/reports/report-quota';
import { createSignedUser } from './fixtures/signed-user';

/** How long another session keeps the reporter's user row (CH-232 v1.1: 4s, under Prisma's 5s transaction timeout). */
const HOLD_MS = 4_000;

/**
 * CH-232 on the real test Postgres: the 3s cap covers only the wait for the
 * account's quota lock. Once that lock is held, the rest of the transaction
 * waits as it did before CH-231, so a report blocked on its reporter's user
 * row (the FK check on insert) succeeds when that row is released.
 */
describe('reports quota lock wait cap covers only the quota lock (CH-232)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let holder: PrismaClient;
  let topicId = '';

  beforeAll(async () => {
    app = await createApp({ rateLimitPrefix: `cardhub:rl:test:${randomUUID()}:` });
    await app.init();
    prisma = app.get(PrismaService);
    holder = new PrismaClient();
    await holder.$connect();
    const owner = await createSignedUser(app);
    const topic = await prisma.topic.create({
      data: {
        slug: `ch232-${randomUUID().slice(0, 8)}`,
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

  /**
   * What the psql session in 32-1 does: BEGIN; SELECT … FROM users WHERE id = … FOR UPDATE;
   * hold for `ms`; COMMIT. Resolves once the row is locked; `released` settles at commit.
   */
  async function holdUserRow(userId: string, ms: number): Promise<{ released: Promise<void> }> {
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const released = holder.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        locked();
        await tx.$queryRaw`SELECT pg_sleep(${ms / 1000})::text`;
      },
      { timeout: ms + 10_000 },
    );
    await Promise.race([isLocked, released]);
    return { released };
  }

  function report(token: string) {
    return request(app.getHttpServer())
      .post('/trpc/reports.create')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.232')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetType: 'TOPIC', targetId: topicId, reason: '广告内容' });
  }

  it('232-A: after the quota lock is taken, the rest of the transaction has no lock wait cap', async () => {
    const a = await createSignedUser(app);
    const settings = await prisma.$transaction(async (tx) => {
      await lockReportQuota(tx, a.id);
      return tx.$queryRaw<Array<{ lock_timeout: string }>>`SHOW lock_timeout`;
    });
    expect(settings).toEqual([{ lock_timeout: '0' }]);
    // Still SET LOCAL: the pooled connection keeps the server default afterwards.
    expect(await prisma.$queryRaw`SHOW lock_timeout`).toEqual([{ lock_timeout: '0' }]);
  });

  it('232-B / 32-1: reporter user row held ~4s → the report succeeds once it is released, three times in a row', async () => {
    const a = await createSignedUser(app);
    for (let round = 1; round <= 3; round += 1) {
      const before = await prisma.report.count({ where: { reporterId: a.id } });
      const { released } = await holdUserRow(a.id, HOLD_MS);
      const started = Date.now();
      const res = await report(a.token);
      const ms = Date.now() - started;
      await released;
      process.stdout.write(`CH-232 round ${round}: ${res.status} after ${ms} ms\n`);
      expect(res.status).toBe(200);
      expect(res.headers['retry-after']).toBeUndefined();
      expect(ms).toBeGreaterThanOrEqual(HOLD_MS - 200);
      expect(ms).toBeLessThan(5_000);
      expect(await prisma.report.count({ where: { reporterId: a.id } })).toBe(before + 1);
    }
  }, 40_000);
});
