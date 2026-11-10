import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { lockReportQuota } from '../src/modules/reports/report-quota';
import { createSignedUser } from './fixtures/signed-user';

type RawClient = Pick<PrismaClient, '$queryRaw'>;

/** One pooled connection, so every statement (in and after a transaction) runs on the same session. */
function singleConnectionClient(
  options: { url?: string; startupOptions?: string } = {},
): PrismaClient {
  const url = new URL(options.url ?? process.env.DATABASE_URL ?? '');
  url.searchParams.set('connection_limit', '1');
  if (options.startupOptions) url.searchParams.set('options', options.startupOptions);
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function backendPid(client: RawClient): Promise<number> {
  const [row] = await client.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

async function showLockTimeout(client: RawClient): Promise<string> {
  const [row] = await client.$queryRaw<Array<{ lock_timeout: string }>>`SHOW lock_timeout`;
  return row.lock_timeout;
}

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
    // CH-233: one connection, so the SHOW after the transaction reads the same session.
    const client = singleConnectionClient();
    try {
      const { pid, settings } = await client.$transaction(async (tx) => {
        await lockReportQuota(tx, a.id);
        return {
          pid: await backendPid(tx),
          settings: await tx.$queryRaw<Array<{ lock_timeout: string }>>`SHOW lock_timeout`,
        };
      });
      expect(settings).toEqual([{ lock_timeout: '0' }]);
      // Still SET LOCAL: the connection keeps the server default afterwards.
      expect(await backendPid(client)).toBe(pid);
      expect(await client.$queryRaw`SHOW lock_timeout`).toEqual([{ lock_timeout: '0' }]);
    } finally {
      await client.$disconnect();
    }
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

  /**
   * CH-233: after the quota lock the transaction goes back to the configured
   * lock_timeout (`SET LOCAL lock_timeout TO DEFAULT`). "Configured" is the
   * reset value: postgresql.conf, ALTER DATABASE, ALTER ROLE, or a connection
   * startup option. A plain session `SET lock_timeout` is not a reset value
   * and is not restored inside the transaction (measured on PG 16).
   */
  async function lockTimeoutAroundQuotaLock(client: PrismaClient, reporterId: string) {
    const before = await showLockTimeout(client);
    const pidBefore = await backendPid(client);
    const inTx = await client.$transaction(async (tx) => {
      await lockReportQuota(tx, reporterId);
      return { pid: await backendPid(tx), lockTimeout: await showLockTimeout(tx) };
    });
    return {
      before,
      inTx: inTx.lockTimeout,
      after: await showLockTimeout(client),
      sameConnection: pidBefore === inTx.pid && inTx.pid === (await backendPid(client)),
    };
  }

  it('233-B: a lock_timeout set as a connection startup option is what applies after the quota lock', async () => {
    const a = await createSignedUser(app);
    const client = singleConnectionClient({ startupOptions: '-c lock_timeout=2s' });
    try {
      expect(await lockTimeoutAroundQuotaLock(client, a.id)).toEqual({
        before: '2s',
        inTx: '2s',
        after: '2s',
        sameConnection: true,
      });
    } finally {
      await client.$disconnect();
    }
  });

  it('233-B: a lock_timeout set on the role (ALTER ROLE … SET) is what applies after the quota lock', async () => {
    const a = await createSignedUser(app);
    const role = `ch233_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const password = randomUUID();
    await prisma.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await prisma.$executeRawUnsafe(`ALTER ROLE ${role} SET lock_timeout = '2500ms'`);
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.username = role;
    url.password = password;
    const client = singleConnectionClient({ url: url.toString() });
    try {
      expect(await lockTimeoutAroundQuotaLock(client, a.id)).toEqual({
        before: '2500ms',
        inTx: '2500ms',
        after: '2500ms',
        sameConnection: true,
      });
    } finally {
      await client.$disconnect();
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
    }
  });
});
