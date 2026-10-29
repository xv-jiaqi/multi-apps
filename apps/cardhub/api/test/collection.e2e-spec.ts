import { mkdirSync, writeFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_ERROR_CODES } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `${label}${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 24),
    ip: `198.51.100.${(sequence % 200) + 1}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new Error('expected a body');
  const result = body.result;
  if (!isRecord(result)) throw new Error('expected a result');
  const data = result.data;
  if (!isRecord(data)) throw new Error('expected a result object');
  return data;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('expected a list');
  const list: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!isRecord(item)) throw new Error('expected a row');
    list.push(item);
  }
  return list;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`expected ${key} to be a string`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number') throw new Error(`expected ${key} to be a number`);
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`expected ${key} to be a boolean`);
  return value;
}

function errorData(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new Error('expected a body');
  const error = body.error;
  if (!isRecord(error)) throw new Error('expected an error');
  const data = error.data;
  if (!isRecord(data)) throw new Error('expected error data');
  return data;
}

function fieldErrors(body: unknown, field: string): string[] {
  const zodError = errorData(body).zodError;
  if (!isRecord(zodError)) throw new Error('expected zodError');
  const fields = zodError.fieldErrors;
  if (!isRecord(fields)) throw new Error('expected fieldErrors');
  const messages = fields[field];
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error(`expected field errors for ${field}`);
  }
  const text: string[] = [];
  for (const message of messages) {
    if (typeof message !== 'string') throw new Error('expected a string field error');
    text.push(message);
  }
  return text;
}

function saveEvidence(name: string, value: unknown): void {
  const dir = '/opt/cursor/artifacts';
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    // Evidence files are for the PR write-up. The assertions above are the test.
  }
}

describe('collection (CH-203 cut-3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let aliceToken = '';
  let bobToken = '';
  let dawnSlug = '';
  let duskSlug = '';
  let alphaSlug = '';
  let betaSlug = '';
  let gammaSlug = '';
  let duskOneSlug = '';
  let duskTwoSlug = '';

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const alice = nextIdentity('colalice');
    const bob = nextIdentity('colbob');
    aliceToken = (await register(alice)).token;
    bobToken = (await register(bob)).token;

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    dawnSlug = `col-dawn-${suffix}`.slice(0, 64);
    duskSlug = `col-dusk-${suffix}`.slice(0, 64);
    alphaSlug = `col-alpha-${suffix}`.slice(0, 64);
    betaSlug = `col-beta-${suffix}`.slice(0, 64);
    gammaSlug = `col-gamma-${suffix}`.slice(0, 64);
    duskOneSlug = `col-dusk-one-${suffix}`.slice(0, 64);
    duskTwoSlug = `col-dusk-two-${suffix}`.slice(0, 64);

    const dawn = await prisma.series.create({ data: { slug: dawnSlug, title: '黎明' } });
    const dusk = await prisma.series.create({ data: { slug: duskSlug, title: '黄昏' } });
    await prisma.card.createMany({
      data: [
        { slug: alphaSlug, name: '阿尔法', seriesId: dawn.id },
        { slug: betaSlug, name: '贝塔', seriesId: dawn.id },
        { slug: gammaSlug, name: '伽马', seriesId: dawn.id },
        { slug: duskOneSlug, name: '暮一', seriesId: dusk.id },
        { slug: duskTwoSlug, name: '暮二', seriesId: dusk.id },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(input: { path: string; body: unknown; token?: string; ip: string }) {
    const req = request(app.getHttpServer())
      .post(`/trpc/${input.path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', input.ip);
    if (input.token) req.set('Authorization', `Bearer ${input.token}`);
    return req.send(input.body);
  }

  function get(input: { path: string; query?: unknown; token?: string; ip: string }) {
    const req = request(app.getHttpServer())
      .get(`/trpc/${input.path}`)
      .set('X-Forwarded-For', input.ip);
    if (input.query !== undefined) req.query({ input: JSON.stringify(input.query) });
    if (input.token) req.set('Authorization', `Bearer ${input.token}`);
    return req;
  }

  async function register(identity: ReturnType<typeof nextIdentity>) {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({
        email: identity.email,
        username: identity.username,
        password: 'collection-password',
      });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    return { token: readString(data, 'token') };
  }

  async function upsert(input: {
    token: string;
    ip: string;
    cardSlug: string;
    ownedCount: number;
    wanted: boolean;
  }) {
    const response = await post({
      path: 'collection.upsert',
      token: input.token,
      ip: input.ip,
      body: {
        cardSlug: input.cardSlug,
        ownedCount: input.ownedCount,
        wanted: input.wanted,
      },
    });
    expect(response.status).toBe(200);
    return resultData(response.body);
  }

  async function listMine(input: { token: string; ip: string; limit?: number; cursor?: string }) {
    const response = await get({
      path: 'collection.list',
      token: input.token,
      ip: input.ip,
      query: {
        limit: input.limit ?? 50,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    return { data, items: rows(data.items), body: response.body };
  }

  async function progress(input: { token: string; ip: string }) {
    const response = await get({
      path: 'collection.progress',
      token: input.token,
      ip: input.ip,
    });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    return { data, items: rows(data.items), body: response.body };
  }

  it('AC3-7 keeps owned 2 and wanted-only after another read, and rejects bad counts and anonymous callers', async () => {
    const owned = await upsert({
      token: aliceToken,
      ip: '203.0.113.40',
      cardSlug: alphaSlug,
      ownedCount: 2,
      wanted: false,
    });
    expect(owned.outcome).toBe('saved');
    if (!isRecord(owned.item)) throw new Error('expected a saved item');
    expect(owned.item.state).toBe('owned');
    expect(readNumber(owned.item, 'ownedCount')).toBe(2);
    expect(readBoolean(owned.item, 'wanted')).toBe(false);
    expect(readString(owned.item, 'cardSlug')).toBe(alphaSlug);

    const wanted = await upsert({
      token: aliceToken,
      ip: '203.0.113.40',
      cardSlug: betaSlug,
      ownedCount: 0,
      wanted: true,
    });
    expect(wanted.outcome).toBe('saved');
    if (!isRecord(wanted.item)) throw new Error('expected a saved item');
    expect(wanted.item.state).toBe('wanted');
    expect(readNumber(wanted.item, 'ownedCount')).toBe(0);
    expect(readBoolean(wanted.item, 'wanted')).toBe(true);

    const first = await listMine({ token: aliceToken, ip: '203.0.113.40' });
    const again = await listMine({ token: aliceToken, ip: '203.0.113.41' });
    const firstAlpha = first.items.find((item) => item.cardSlug === alphaSlug);
    const againAlpha = again.items.find((item) => item.cardSlug === alphaSlug);
    const againBeta = again.items.find((item) => item.cardSlug === betaSlug);
    expect(firstAlpha).toBeDefined();
    expect(againAlpha).toEqual(firstAlpha);
    expect(againBeta).toMatchObject({
      state: 'wanted',
      cardSlug: betaSlug,
      ownedCount: 0,
      wanted: true,
    });

    const both = await upsert({
      token: aliceToken,
      ip: '203.0.113.40',
      cardSlug: alphaSlug,
      ownedCount: 2,
      wanted: true,
    });
    expect(both.outcome).toBe('saved');
    if (!isRecord(both.item)) throw new Error('expected a saved item');
    expect(both.item.state).toBe('owned');
    expect(readNumber(both.item, 'ownedCount')).toBe(2);
    expect(readBoolean(both.item, 'wanted')).toBe(true);
    const kept = await listMine({ token: aliceToken, ip: '203.0.113.40' });
    expect(kept.items.find((item) => item.cardSlug === alphaSlug)).toMatchObject({
      state: 'owned',
      ownedCount: 2,
      wanted: true,
    });

    const invalidCounts: unknown[] = [-1, 100, 1.5, '2', null];
    for (const ownedCount of invalidCounts) {
      const response = await post({
        path: 'collection.upsert',
        token: aliceToken,
        ip: '203.0.113.42',
        body: { cardSlug: alphaSlug, ownedCount, wanted: false },
      });
      expect(response.status).toBe(400);
      expect(errorData(response.body).code).toBe('BAD_REQUEST');
      expect(errorData(response.body).appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(fieldErrors(response.body, 'ownedCount').length).toBeGreaterThan(0);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('ZodError');
      expect(serialized).not.toContain('Invalid input');
      expect(serialized).not.toContain('prisma');
    }

    const badWanted = await post({
      path: 'collection.upsert',
      token: aliceToken,
      ip: '203.0.113.42',
      body: { cardSlug: alphaSlug, ownedCount: 1, wanted: 'yes' },
    });
    expect(badWanted.status).toBe(400);
    expect(errorData(badWanted.body).code).toBe('BAD_REQUEST');
    expect(errorData(badWanted.body).appCode).toBe(APP_ERROR_CODES.VALIDATION);
    expect(fieldErrors(badWanted.body, 'wanted').length).toBeGreaterThan(0);

    const anonymousPaths: Array<{ path: string; method: 'post' | 'get'; body?: unknown }> = [
      {
        path: 'collection.upsert',
        method: 'post',
        body: { cardSlug: alphaSlug, ownedCount: 1, wanted: false },
      },
      { path: 'collection.list', method: 'get', body: { limit: 20 } },
      { path: 'collection.progress', method: 'get' },
    ];
    for (const call of anonymousPaths) {
      const response =
        call.method === 'post'
          ? await post({ path: call.path, ip: '203.0.113.43', body: call.body })
          : await get({
              path: call.path,
              ip: '203.0.113.43',
              ...(call.body !== undefined ? { query: call.body } : {}),
            });
      expect(response.status).toBe(401);
      expect(errorData(response.body).code).toBe('UNAUTHORIZED');
      expect(errorData(response.body).appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
    }

    saveEvidence('ac3-7-alice-upsert-owned', owned);
    saveEvidence('ac3-7-alice-upsert-wanted', wanted);
  });

  it('AC3-8 counts owned cards once per card and keeps the two accounts apart', async () => {
    await upsert({
      token: aliceToken,
      ip: '203.0.113.50',
      cardSlug: alphaSlug,
      ownedCount: 2,
      wanted: true,
    });
    await upsert({
      token: aliceToken,
      ip: '203.0.113.50',
      cardSlug: betaSlug,
      ownedCount: 0,
      wanted: true,
    });
    await upsert({
      token: bobToken,
      ip: '203.0.113.51',
      cardSlug: duskOneSlug,
      ownedCount: 1,
      wanted: false,
    });

    const aliceList = await listMine({ token: aliceToken, ip: '203.0.113.50' });
    const bobList = await listMine({ token: bobToken, ip: '203.0.113.51' });
    expect(aliceList.items.map((item) => item.cardSlug).sort()).toEqual(
      [alphaSlug, betaSlug].sort(),
    );
    expect(bobList.items.map((item) => item.cardSlug)).toEqual([duskOneSlug]);
    expect(JSON.stringify(bobList.body)).not.toContain(alphaSlug);
    expect(JSON.stringify(bobList.body)).not.toContain(betaSlug);
    expect(JSON.stringify(aliceList.body)).not.toContain(duskOneSlug);

    const aliceProgress = await progress({ token: aliceToken, ip: '203.0.113.50' });
    const bobProgress = await progress({ token: bobToken, ip: '203.0.113.51' });
    const aliceDawn = aliceProgress.items.find((item) => item.seriesSlug === dawnSlug);
    const bobDusk = bobProgress.items.find((item) => item.seriesSlug === duskSlug);
    expect(aliceDawn).toMatchObject({
      seriesSlug: dawnSlug,
      seriesTitle: '黎明',
      owned: 1,
      total: 3,
    });
    expect(aliceProgress.items.some((item) => item.seriesSlug === duskSlug)).toBe(false);
    expect(bobDusk).toMatchObject({
      seriesSlug: duskSlug,
      seriesTitle: '黄昏',
      owned: 1,
      total: 2,
    });
    expect(bobProgress.items.some((item) => item.seriesSlug === dawnSlug)).toBe(false);
    expect(readNumber(aliceDawn ?? {}, 'owned')).not.toBe(2);

    saveEvidence('ac3-8-alice-list', aliceList.body);
    saveEvidence('ac3-8-bob-list', bobList.body);
    saveEvidence('ac3-8-alice-progress', aliceProgress.body);
    saveEvidence('ac3-8-bob-progress', bobProgress.body);
  });

  it('deletes the row when the count is 0 and the card is not wanted', async () => {
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const slug = `col-clear-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({
      data: { slug: `col-clear-series-${suffix}`.slice(0, 64), title: '清除' },
    });
    await prisma.card.create({ data: { slug, name: '清除卡', seriesId: series.id } });

    const saved = await upsert({
      token: aliceToken,
      ip: '203.0.113.60',
      cardSlug: slug,
      ownedCount: 1,
      wanted: false,
    });
    expect(saved.outcome).toBe('saved');

    const removed = await upsert({
      token: aliceToken,
      ip: '203.0.113.60',
      cardSlug: slug,
      ownedCount: 0,
      wanted: false,
    });
    expect(removed).toEqual({ outcome: 'removed', cardSlug: slug });

    const listed = await listMine({ token: aliceToken, ip: '203.0.113.60' });
    expect(listed.items.some((item) => item.cardSlug === slug)).toBe(false);

    const missingAgain = await upsert({
      token: aliceToken,
      ip: '203.0.113.60',
      cardSlug: slug,
      ownedCount: 0,
      wanted: false,
    });
    expect(missingAgain).toEqual({ outcome: 'removed', cardSlug: slug });
  });

  it('rejects an unknown card and accepts the inclusive count bounds', async () => {
    const missing = await post({
      path: 'collection.upsert',
      token: aliceToken,
      ip: '203.0.113.61',
      body: { cardSlug: 'missing-collection-card', ownedCount: 1, wanted: false },
    });
    expect(missing.status).toBe(404);
    expect(errorData(missing.body).code).toBe('NOT_FOUND');
    expect(errorData(missing.body).appCode).toBe(APP_ERROR_CODES.NOT_FOUND);
    expect(JSON.stringify(missing.body)).not.toContain('prisma');

    const top = await upsert({
      token: bobToken,
      ip: '203.0.113.62',
      cardSlug: gammaSlug,
      ownedCount: 99,
      wanted: false,
    });
    expect(top.outcome).toBe('saved');
    if (!isRecord(top.item)) throw new Error('expected a saved item');
    expect(readNumber(top.item, 'ownedCount')).toBe(99);

    const zeroWanted = await upsert({
      token: bobToken,
      ip: '203.0.113.62',
      cardSlug: gammaSlug,
      ownedCount: 0,
      wanted: true,
    });
    expect(zeroWanted.outcome).toBe('saved');
    if (!isRecord(zeroWanted.item)) throw new Error('expected a saved item');
    expect(zeroWanted.item.state).toBe('wanted');

    await upsert({
      token: bobToken,
      ip: '203.0.113.62',
      cardSlug: gammaSlug,
      ownedCount: 0,
      wanted: false,
    });
    const listed = await listMine({ token: bobToken, ip: '203.0.113.62' });
    expect(listed.items.some((item) => item.cardSlug === gammaSlug)).toBe(false);
  });

  it('pages the caller collection and throttles a second upsert from the same IP', async () => {
    await upsert({
      token: aliceToken,
      ip: '203.0.113.70',
      cardSlug: alphaSlug,
      ownedCount: 2,
      wanted: true,
    });
    await upsert({
      token: aliceToken,
      ip: '203.0.113.70',
      cardSlug: betaSlug,
      ownedCount: 0,
      wanted: true,
    });

    const firstPage = await listMine({ token: aliceToken, ip: '203.0.113.70', limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    const cursor = firstPage.data.nextCursor;
    expect(typeof cursor).toBe('string');
    if (typeof cursor !== 'string') throw new Error('expected a cursor');
    const secondPage = await listMine({
      token: aliceToken,
      ip: '203.0.113.70',
      limit: 1,
      cursor,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.data.nextCursor).toBeNull();
    expect([firstPage.items[0]?.cardSlug, secondPage.items[0]?.cardSlug].sort()).toEqual(
      [alphaSlug, betaSlug].sort(),
    );

    let limited: INestApplication | undefined;
    try {
      limited = await createApp({
        rateLimitOverrides: { collectionUpsert: { limit: 1, windowMs: 60_000 } },
      });
      await limited.init();
      const server = limited.getHttpServer();
      const first = await request(server)
        .post('/trpc/collection.upsert')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Forwarded-For', '203.0.113.80')
        .send({ cardSlug: alphaSlug, ownedCount: 2, wanted: true });
      expect(first.status).toBe(200);

      const second = await request(server)
        .post('/trpc/collection.upsert')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Forwarded-For', '203.0.113.80')
        .send({ cardSlug: betaSlug, ownedCount: 0, wanted: true });
      expect(second.status).toBe(429);
      expect(errorData(second.body).code).toBe('TOO_MANY_REQUESTS');
      expect(errorData(second.body).appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);

      const listed = await request(server)
        .get('/trpc/collection.list')
        .query({ input: JSON.stringify({ limit: 20 }) })
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Forwarded-For', '203.0.113.80');
      expect(listed.status).not.toBe(429);
      expect(listed.status).toBe(200);
    } finally {
      await limited?.close();
    }
  });
});
