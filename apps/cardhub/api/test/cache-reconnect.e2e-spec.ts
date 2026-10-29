import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';

const exec = promisify(execFile);
const REDIS_PORT = '6391';
const REDIS_DIR = '/tmp/cardhub-cache-purge-redis';
const CACHE_PROBE = 'cardhub:cache:v1:reconnect-probe';
const RATE_LIMIT_PROBE = 'cardhub:rl:v1:reconnect-probe';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected tRPC result data');
  }
  return body.result.data;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`expected ${label}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function redisCli(...args: string[]): Promise<string> {
  const { stdout } = await exec('redis-cli', ['-p', REDIS_PORT, ...args], {
    timeout: 5_000,
  });
  return stdout.trim();
}

async function startRedis(): Promise<void> {
  await mkdir(REDIS_DIR, { recursive: true });
  await exec(
    'redis-server',
    [
      '--port',
      REDIS_PORT,
      '--bind',
      '127.0.0.1',
      '--dir',
      REDIS_DIR,
      '--dbfilename',
      'dump.rdb',
      '--appendonly',
      'no',
      '--save',
      '',
      '--daemonize',
      'yes',
      '--protected-mode',
      'yes',
      '--logfile',
      `${REDIS_DIR}/redis.log`,
    ],
    { timeout: 5_000 },
  );
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await redisCli('PING')) === 'PONG') return;
    } catch {
      // The process is still opening the port.
    }
    await sleep(50);
  }
  throw new Error('dedicated redis did not answer PING');
}

async function stopRedisSave(): Promise<void> {
  try {
    await redisCli('SHUTDOWN', 'SAVE');
  } catch {
    // Already stopped.
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await redisCli('PING');
    } catch {
      return;
    }
    await sleep(50);
  }
  throw new Error('dedicated redis did not stop');
}

async function waitForStatus(
  app: INestApplication,
  ready: boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isReady = app.get(RedisService).client.status === 'ready';
    if (isReady === ready) return;
    await sleep(50);
  }
  throw new Error(`redis client stayed ${app.get(RedisService).client.status}`);
}

describe('catalog cache reconnect', () => {
  jest.setTimeout(60_000);

  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  const previousHost = process.env.REDIS_HOST;
  const previousPort = process.env.REDIS_PORT;
  const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`.replace(/[^a-z0-9]/gi, '');
  const seriesSlug = `reconn-series-${suffix}`.slice(0, 64);
  const cardSlug = `reconn-card-${suffix}`.slice(0, 64);
  const adminEmail = `reconn-admin-${suffix}@cardhub.test`;
  const adminUsername = `radm${suffix}`.slice(0, 24);
  let adminToken = '';

  beforeAll(async () => {
    await stopRedisSave();
    await rm(REDIS_DIR, { recursive: true, force: true });
    await startRedis();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = REDIS_PORT;
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.80')
      .send({
        email: adminEmail,
        username: adminUsername,
        password: 'cache-password',
      });
    expect(registered.status).toBe(200);
    adminToken = readString(resultData(registered.body).token, 'token');
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });
    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: '重连系列' },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: '停机前', seriesId: series.id, rarity: 'rare' },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: cardSlug } });
      await prisma.series.deleteMany({ where: { slug: seriesSlug } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
    await app?.close();
    await stopRedisSave();
    await rm(REDIS_DIR, { recursive: true, force: true });
    if (previousHost === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = previousHost;
    if (previousPort === undefined) delete process.env.REDIS_PORT;
    else process.env.REDIS_PORT = previousPort;
  });

  it('returns the post-outage write after Redis restarts with the old cache keys', async () => {
    if (!app || !prisma) throw new Error('app did not start');
    const server = app.getHttpServer();

    const warmed = await request(server)
      .get('/trpc/cards.bySlug')
      .query({ input: JSON.stringify({ slug: cardSlug }) });
    expect(warmed.status).toBe(200);
    expect(readString(resultData(warmed.body).name, 'name')).toBe('停机前');

    expect(await redisCli('SET', CACHE_PROBE, 'stale')).toBe('OK');
    expect(await redisCli('SET', RATE_LIMIT_PROBE, 'keep')).toBe('OK');

    await stopRedisSave();
    await waitForStatus(app, false, 5_000);

    const written = await request(server)
      .post('/trpc/admin.cards.update')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '203.0.113.83')
      .send({
        slug: cardSlug,
        name: '恢复后',
        rarity: 'rare',
        attributes: {},
        seriesSlug,
      });
    expect(written.status).toBe(200);

    await startRedis();
    await waitForStatus(app, true, 15_000);

    let fresh = false;
    let probeGone = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const read = await request(server)
        .get('/trpc/cards.bySlug')
        .query({ input: JSON.stringify({ slug: cardSlug }) });
      expect(read.status).toBe(200);
      fresh = readString(resultData(read.body).name, 'name') === '恢复后';
      const probe = await redisCli('GET', CACHE_PROBE);
      probeGone = probe === '' || probe === '(nil)';
      if (fresh && probeGone) break;
      await sleep(100);
    }

    expect(fresh).toBe(true);
    expect(probeGone).toBe(true);
    expect(await redisCli('GET', RATE_LIMIT_PROBE)).toBe('keep');
  });
});

describe('X-Cache header', () => {
  jest.setTimeout(30_000);

  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  const previousEnvName = process.env.ENV_NAME;
  const previousHeader = process.env.CATALOG_CACHE_HEADER;
  const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`.replace(/[^a-z0-9]/gi, '');
  const seriesSlug = `xcache-series-${suffix}`.slice(0, 64);
  const cardSlug = `xcache-card-${suffix}`.slice(0, 64);

  beforeAll(async () => {
    process.env.ENV_NAME = 'staging';
    process.env.CATALOG_CACHE_HEADER = 'true';
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: '头系列' },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: '头卡', seriesId: series.id, rarity: 'common' },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: cardSlug } });
      await prisma.series.deleteMany({ where: { slug: seriesSlug } });
    }
    await app?.close();
    if (previousEnvName === undefined) delete process.env.ENV_NAME;
    else process.env.ENV_NAME = previousEnvName;
    if (previousHeader === undefined) delete process.env.CATALOG_CACHE_HEADER;
    else process.env.CATALOG_CACHE_HEADER = previousHeader;
  });

  it('reports MISS then HIT on staging, and omits the header otherwise', async () => {
    if (!app) throw new Error('app did not start');
    const read = () =>
      request(app?.getHttpServer())
        .get('/trpc/cards.bySlug')
        .query({ input: JSON.stringify({ slug: cardSlug }) });

    const miss = await read();
    expect(miss.status).toBe(200);
    expect(miss.headers['x-cache']).toBe('MISS');

    const hit = await read();
    expect(hit.status).toBe(200);
    expect(hit.headers['x-cache']).toBe('HIT');
    expect(readString(resultData(hit.body).name, 'name')).toBe('头卡');

    process.env.ENV_NAME = 'prod';
    const production = await read();
    expect(production.status).toBe(200);
    expect(production.headers['x-cache']).toBeUndefined();

    process.env.ENV_NAME = 'staging';
    delete process.env.CATALOG_CACHE_HEADER;
    const disabled = await read();
    expect(disabled.status).toBe(200);
    expect(disabled.headers['x-cache']).toBeUndefined();
  });
});
