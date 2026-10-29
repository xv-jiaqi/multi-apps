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
    ip: `192.0.2.${(sequence % 200) + 1}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultValue(body: unknown): unknown {
  if (!isRecord(body)) throw new Error('expected a body');
  const result = body.result;
  if (!isRecord(result)) throw new Error('expected a result');
  return result.data;
}

function resultData(body: unknown): Record<string, unknown> {
  const data = resultValue(body);
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

describe('collection follow-up (CH-203)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
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
    const user = await prisma.user.findUniqueOrThrow({ where: { email: identity.email } });
    return { token: readString(resultData(response.body), 'token'), userId: user.id };
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

  async function listMine(input: {
    token: string;
    ip: string;
    limit?: number;
    cursor?: string;
    state?: string;
  }) {
    const response = await get({
      path: 'collection.list',
      token: input.token,
      ip: input.ip,
      query: {
        limit: input.limit ?? 20,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.state ? { state: input.state } : {}),
      },
    });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    return { data, items: rows(data.items) };
  }

  async function catalog(input: {
    title: string;
    cards: Array<{ slug: string; name: string; imageUrl?: string | null }>;
  }) {
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const series = await prisma.series.create({
      data: { slug: `col-fu-${suffix}`.slice(0, 64), title: input.title },
    });
    await prisma.card.createMany({
      data: input.cards.map((card) => ({
        slug: card.slug,
        name: card.name,
        seriesId: series.id,
        imageUrl: card.imageUrl ?? null,
      })),
    });
    return series;
  }

  it('returns collection_quantity when the owned count is not an integer from 0 to 99', async () => {
    const alice = await register(nextIdentity('qty'));
    const slug = `col-qty-${Date.now().toString(36)}`.slice(0, 64);
    await catalog({ title: '数量', cards: [{ slug, name: '数量卡' }] });
    for (const ownedCount of [-1, 100, 1.5, '2', null]) {
      const response = await post({
        path: 'collection.upsert',
        token: alice.token,
        ip: '192.0.2.210',
        body: { cardSlug: slug, ownedCount, wanted: false },
      });
      expect(response.status).toBe(400);
      expect(errorData(response.body).code).toBe('BAD_REQUEST');
      expect(errorData(response.body).appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(fieldErrors(response.body, 'ownedCount')).toEqual(['collection_quantity']);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('Invalid input');
      expect(serialized).not.toContain('prisma');
    }
  });

  it('keeps paging when timestamps match, the cursor row is deleted, or that row moves', async () => {
    const alice = await register(nextIdentity('cursor'));
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const slugs = [0, 1, 2, 3].map((index) => `col-cur-${index}-${suffix}`.slice(0, 64));
    await catalog({
      title: '游标',
      cards: slugs.map((slug, index) => ({ slug, name: `游标${index}` })),
    });
    for (const slug of slugs) {
      await upsert({
        token: alice.token,
        ip: '192.0.2.211',
        cardSlug: slug,
        ownedCount: 1,
        wanted: false,
      });
    }

    const first = await listMine({ token: alice.token, ip: '192.0.2.211', limit: 2 });
    expect(first.items).toHaveLength(2);
    const boundary = first.data.nextCursor;
    expect(typeof boundary).toBe('string');
    if (typeof boundary !== 'string') throw new Error('expected a cursor');
    const movedId = readString(first.items[1] ?? {}, 'id');
    await upsert({
      token: alice.token,
      ip: '192.0.2.211',
      cardSlug: readString(first.items[1] ?? {}, 'cardSlug'),
      ownedCount: 2,
      wanted: true,
    });
    const afterMove = await listMine({
      token: alice.token,
      ip: '192.0.2.211',
      limit: 2,
      cursor: boundary,
    });
    const seen = new Set(first.items.map((item) => item.id));
    expect(afterMove.items.map((item) => item.id).some((id) => seen.has(id))).toBe(false);
    expect(afterMove.items.map((item) => item.id)).not.toContain(movedId);

    const tieSlugs = slugs.slice(0, 3);
    const stamp = new Date('2026-01-15T00:00:00.000Z');
    await prisma.$executeRaw`
      UPDATE collection_items
      SET "updatedAt" = ${stamp}
      WHERE "userId" = ${alice.userId} AND "cardId" IN (
        SELECT id FROM cards WHERE slug IN (${tieSlugs[0]}, ${tieSlugs[1]}, ${tieSlugs[2]})
      )
    `;
    const tieSeen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const listed = await listMine({
        token: alice.token,
        ip: '192.0.2.211',
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      for (const item of listed.items) tieSeen.add(readString(item, 'cardSlug'));
      const next = listed.data.nextCursor;
      if (typeof next !== 'string') {
        cursor = undefined;
        break;
      }
      cursor = next;
    }
    expect(cursor).toBeUndefined();
    for (const slug of slugs) expect(tieSeen.has(slug)).toBe(true);
    expect(tieSeen.size).toBe(slugs.length);

    const fresh = await register(nextIdentity('cursordel'));
    const deleteSlugs = [0, 1, 2].map((index) => `col-del-${index}-${suffix}`.slice(0, 64));
    await catalog({
      title: '删游标',
      cards: deleteSlugs.map((slug, index) => ({ slug, name: `删除${index}` })),
    });
    for (const slug of deleteSlugs) {
      await upsert({
        token: fresh.token,
        ip: '192.0.2.212',
        cardSlug: slug,
        ownedCount: 1,
        wanted: false,
      });
    }
    const head = await listMine({ token: fresh.token, ip: '192.0.2.212', limit: 1 });
    const headCursor = head.data.nextCursor;
    expect(typeof headCursor).toBe('string');
    if (typeof headCursor !== 'string') throw new Error('expected a cursor');
    const removedId = readString(head.items[0] ?? {}, 'id');
    await prisma.collectionItem.delete({ where: { id: removedId } });
    const rest = await listMine({
      token: fresh.token,
      ip: '192.0.2.212',
      limit: 10,
      cursor: headCursor,
    });
    expect(rest.items.map((item) => item.id)).not.toContain(removedId);
    expect(rest.items).toHaveLength(2);
    expect(new Set(rest.items.map((item) => readString(item, 'cardSlug')))).toEqual(
      new Set(deleteSlugs.filter((slug) => slug !== readString(head.items[0] ?? {}, 'cardSlug'))),
    );
  });

  it('lists a want-only series with owned 0', async () => {
    const alice = await register(nextIdentity('wantprog'));
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const wantedSlug = `col-only-want-${suffix}`.slice(0, 64);
    const otherSlug = `col-only-other-${suffix}`.slice(0, 64);
    const series = await catalog({
      title: '只想要',
      cards: [
        { slug: wantedSlug, name: '想要卡' },
        { slug: otherSlug, name: '未收藏' },
      ],
    });
    await upsert({
      token: alice.token,
      ip: '192.0.2.213',
      cardSlug: wantedSlug,
      ownedCount: 0,
      wanted: true,
    });
    const response = await get({
      path: 'collection.progress',
      token: alice.token,
      ip: '192.0.2.213',
    });
    expect(response.status).toBe(200);
    const items = rows(resultData(response.body).items);
    expect(items.find((item) => item.seriesSlug === series.slug)).toMatchObject({
      seriesTitle: '只想要',
      owned: 0,
      total: 2,
    });
  });

  it('treats the first concurrent write of one card as idempotent', async () => {
    const alice = await register(nextIdentity('race'));
    const slug = `col-race-${Date.now().toString(36)}`.slice(0, 64);
    await catalog({ title: '并发', cards: [{ slug, name: '并发卡' }] });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        post({
          path: 'collection.upsert',
          token: alice.token,
          ip: '192.0.2.214',
          body: { cardSlug: slug, ownedCount: 1, wanted: false },
        }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(resultData(response.body).outcome).toBe('saved');
    }
    const listed = await listMine({ token: alice.token, ip: '192.0.2.214' });
    expect(listed.items.filter((item) => item.cardSlug === slug)).toHaveLength(1);
  });

  it('reads only the caller card, returns null when nothing is stored, and rejects anonymous callers', async () => {
    const alice = await register(nextIdentity('byalice'));
    const bob = await register(nextIdentity('bybob'));
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const aliceSlug = `col-by-alice-${suffix}`.slice(0, 64);
    const bobSlug = `col-by-bob-${suffix}`.slice(0, 64);
    const emptySlug = `col-by-empty-${suffix}`.slice(0, 64);
    await catalog({
      title: '按卡',
      cards: [
        { slug: aliceSlug, name: '爱丽丝卡' },
        { slug: bobSlug, name: '鲍勃卡' },
        { slug: emptySlug, name: '空卡' },
      ],
    });
    await upsert({
      token: alice.token,
      ip: '192.0.2.215',
      cardSlug: aliceSlug,
      ownedCount: 2,
      wanted: true,
    });
    await upsert({
      token: bob.token,
      ip: '192.0.2.216',
      cardSlug: bobSlug,
      ownedCount: 1,
      wanted: false,
    });

    const aliceCard = await get({
      path: 'collection.byCard',
      token: alice.token,
      ip: '192.0.2.215',
      query: { cardSlug: aliceSlug },
    });
    expect(aliceCard.status).toBe(200);
    expect(resultValue(aliceCard.body)).toEqual({ ownedCount: 2, wanted: true });

    const aliceReadsBob = await get({
      path: 'collection.byCard',
      token: alice.token,
      ip: '192.0.2.215',
      query: { cardSlug: bobSlug },
    });
    expect(aliceReadsBob.status).toBe(200);
    expect(resultValue(aliceReadsBob.body)).toBeNull();
    expect(JSON.stringify(aliceReadsBob.body)).not.toContain(bobSlug);

    const bobReadsAlice = await get({
      path: 'collection.byCard',
      token: bob.token,
      ip: '192.0.2.216',
      query: { cardSlug: aliceSlug },
    });
    expect(resultValue(bobReadsAlice.body)).toBeNull();

    const empty = await get({
      path: 'collection.byCard',
      token: alice.token,
      ip: '192.0.2.215',
      query: { cardSlug: emptySlug },
    });
    expect(empty.status).toBe(200);
    expect(resultValue(empty.body)).toBeNull();

    const anonymous = await get({
      path: 'collection.byCard',
      ip: '192.0.2.217',
      query: { cardSlug: aliceSlug },
    });
    expect(anonymous.status).toBe(401);
    expect(errorData(anonymous.body).code).toBe('UNAUTHORIZED');
    expect(errorData(anonymous.body).appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
  });

  it('filters list by state and returns each card imageUrl', async () => {
    const alice = await register(nextIdentity('statea'));
    const bob = await register(nextIdentity('stateb'));
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const ownedSlug = `col-st-owned-${suffix}`.slice(0, 64);
    const wantedSlug = `col-st-wanted-${suffix}`.slice(0, 64);
    const bothSlug = `col-st-both-${suffix}`.slice(0, 64);
    const bobSlug = `col-st-bob-${suffix}`.slice(0, 64);
    await catalog({
      title: '筛选',
      cards: [
        { slug: ownedSlug, name: '只拥有', imageUrl: 'https://images.example.test/owned.png' },
        { slug: wantedSlug, name: '只想要', imageUrl: null },
        { slug: bothSlug, name: '都要', imageUrl: 'http://insecure.example.test/both.png' },
        { slug: bobSlug, name: '鲍勃', imageUrl: 'https://images.example.test/bob.png' },
      ],
    });
    await upsert({
      token: alice.token,
      ip: '192.0.2.218',
      cardSlug: ownedSlug,
      ownedCount: 2,
      wanted: false,
    });
    await upsert({
      token: alice.token,
      ip: '192.0.2.218',
      cardSlug: wantedSlug,
      ownedCount: 0,
      wanted: true,
    });
    await upsert({
      token: alice.token,
      ip: '192.0.2.218',
      cardSlug: bothSlug,
      ownedCount: 1,
      wanted: true,
    });
    await upsert({
      token: bob.token,
      ip: '192.0.2.219',
      cardSlug: bobSlug,
      ownedCount: 3,
      wanted: true,
    });

    const omitted = await listMine({ token: alice.token, ip: '192.0.2.218' });
    const all = await listMine({ token: alice.token, ip: '192.0.2.218', state: 'all' });
    const owned = await listMine({ token: alice.token, ip: '192.0.2.218', state: 'owned' });
    const wanted = await listMine({ token: alice.token, ip: '192.0.2.218', state: 'wanted' });
    const slugs = (items: Array<Record<string, unknown>>) =>
      items.map((item) => readString(item, 'cardSlug')).sort();

    expect(slugs(omitted.items)).toEqual(slugs(all.items));
    expect(slugs(all.items)).toEqual([bothSlug, ownedSlug, wantedSlug].sort());
    expect(slugs(owned.items)).toEqual([bothSlug, ownedSlug].sort());
    expect(slugs(wanted.items)).toEqual([bothSlug, wantedSlug].sort());
    expect(JSON.stringify(all.items)).not.toContain(bobSlug);

    const bobOwned = await listMine({ token: bob.token, ip: '192.0.2.219', state: 'owned' });
    const bobWanted = await listMine({ token: bob.token, ip: '192.0.2.219', state: 'wanted' });
    expect(slugs(bobOwned.items)).toEqual([bobSlug]);
    expect(slugs(bobWanted.items)).toEqual([bobSlug]);
    expect(JSON.stringify(bobOwned.items)).not.toContain(ownedSlug);
    expect(JSON.stringify(bobWanted.items)).not.toContain(alice.token);

    const bySlug = new Map(all.items.map((item) => [readString(item, 'cardSlug'), item]));
    expect(bySlug.get(ownedSlug)?.imageUrl).toBe('https://images.example.test/owned.png');
    expect(bySlug.get(wantedSlug)?.imageUrl).toBeNull();
    expect(bySlug.get(bothSlug)?.imageUrl).toBe('http://insecure.example.test/both.png');

    const invalid = await get({
      path: 'collection.list',
      token: alice.token,
      ip: '192.0.2.218',
      query: { state: 'nope' },
    });
    expect(invalid.status).toBe(400);
    expect(errorData(invalid.body).code).toBe('BAD_REQUEST');
    expect(errorData(invalid.body).appCode).toBe(APP_ERROR_CODES.VALIDATION);
    const serialized = JSON.stringify(invalid.body);
    expect(serialized).not.toContain('Invalid option');
    expect(serialized).not.toContain('prisma');
  });
});
