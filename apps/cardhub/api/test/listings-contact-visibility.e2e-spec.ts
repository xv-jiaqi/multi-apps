import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * CH-250: anonymous callers must not receive listing contact text on any
 * public path. Signed-in callers receive the original string.
 */

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `${label}${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 24),
    ip: `203.0.113.${(sequence % 200) + 1}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.result)) throw new Error('expected a tRPC result');
  return body.result.data;
}

function expectString(value: unknown): string {
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
}

function listingItems(body: unknown): Array<Record<string, unknown>> {
  const data = resultData(body);
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.items)) return data.items.filter(isRecord);
  throw new Error('expected listing items');
}

describe('listing contact visibility (CH-250)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let viewerToken = '';
  let cardSlug = '';
  let listingId = '';
  const contactMarker = `wx-ch250-secret-${Date.now().toString(36)}`;
  const noteMarker = `note-ch250-public-${Date.now().toString(36)}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const owner = nextIdentity('own');
    const viewer = nextIdentity('view');
    ownerToken = (await register(owner)).token;
    viewerToken = (await register(viewer)).token;

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const seriesSlug = `ch250-series-${suffix}`.slice(0, 64);
    cardSlug = `ch250-card-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: 'CH-250 系列' },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: 'CH-250 卡', seriesId: series.id },
    });

    const published = await post(
      'listings.publish',
      {
        cardSlug,
        kind: 'SELL',
        currency: 'CNY',
        contact: contactMarker,
        note: noteMarker,
        imageUrls: [],
      },
      ownerToken,
      '203.0.113.20',
    );
    expect(published.status).toBe(200);
    const created = resultData(published.body);
    if (!isRecord(created)) throw new Error('expected a published listing');
    expect(created.contact).toBe(contactMarker);
    listingId = expectString(created.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, body: unknown, token: string | null, ip: string) {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function query(path: string, input: unknown, token: string | null, ip: string) {
    const req = request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
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
        password: 'contact-password',
      });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    if (!isRecord(data) || !isRecord(data.user)) throw new Error('expected a user');
    return { token: expectString(data.token), id: expectString(data.user.id) };
  }

  function expectNoContactLeak(body: unknown) {
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(contactMarker);
  }

  async function expectAnonymousRedaction(path: string, body: unknown, token: string | null) {
    const response = await query(path, body, token, '203.0.113.30');
    expect(response.status).toBe(200);
    expectNoContactLeak(response.body);
    const items = listingItems(response.body);
    const match = items.find((item) => item.id === listingId);
    expect(match).toBeDefined();
    expect(match?.contact).toBeNull();
    expect(match?.note).toBe(noteMarker);
    return match;
  }

  it('returns contact: null on list and byCard when the caller is anonymous', async () => {
    await expectAnonymousRedaction('listings.list', { limit: 20, cardSlug }, null);
    await expectAnonymousRedaction('listings.byCard', { cardSlug, limit: 5 }, null);
  });

  it('does not leak contact when the bearer token is invalid', async () => {
    await expectAnonymousRedaction('listings.list', { limit: 20, cardSlug }, 'not-a-jwt');
    await expectAnonymousRedaction('listings.byCard', { cardSlug, limit: 5 }, 'not-a-jwt');
  });

  it('returns the original contact on list and byCard when the caller is signed in', async () => {
    const listed = await query(
      'listings.list',
      { limit: 20, cardSlug },
      viewerToken,
      '203.0.113.31',
    );
    expect(listed.status).toBe(200);
    const listItem = listingItems(listed.body).find((item) => item.id === listingId);
    expect(listItem?.contact).toBe(contactMarker);

    const byCard = await query(
      'listings.byCard',
      { cardSlug, limit: 5 },
      viewerToken,
      '203.0.113.32',
    );
    expect(byCard.status).toBe(200);
    const cardItem = listingItems(byCard.body).find((item) => item.id === listingId);
    expect(cardItem?.contact).toBe(contactMarker);
  });

  it('still returns the original contact on mine for the owner', async () => {
    const mine = await query('listings.mine', { limit: 20 }, ownerToken, '203.0.113.33');
    expect(mine.status).toBe(200);
    const item = listingItems(mine.body).find((row) => row.id === listingId);
    expect(item?.contact).toBe(contactMarker);
  });

  it('rejects listings.mine without a session and does not leak contact', async () => {
    const response = await query('listings.mine', { limit: 20 }, null, '203.0.113.34');
    expect(response.status).toBe(401);
    expectNoContactLeak(response.body);
  });

  it('does not leak contact on the GET form of the public procedures', async () => {
    const list = await request(app.getHttpServer())
      .get('/trpc/listings.list')
      .query({ input: JSON.stringify({ limit: 20, cardSlug }) })
      .set('X-Forwarded-For', '203.0.113.35');
    expect(list.status).toBe(200);
    expectNoContactLeak(list.body);
    const listItem = listingItems(list.body).find((item) => item.id === listingId);
    expect(listItem?.contact).toBeNull();

    const byCard = await request(app.getHttpServer())
      .get('/trpc/listings.byCard')
      .query({ input: JSON.stringify({ cardSlug, limit: 5 }) })
      .set('X-Forwarded-For', '203.0.113.36');
    expect(byCard.status).toBe(200);
    expectNoContactLeak(byCard.body);
    const cardItem = listingItems(byCard.body).find((item) => item.id === listingId);
    expect(cardItem?.contact).toBeNull();
  });

  it('does not leak contact on a batched GET of list and byCard', async () => {
    const batched = await request(app.getHttpServer())
      .get('/trpc/listings.list,listings.byCard')
      .query({
        batch: '1',
        input: JSON.stringify({
          0: { limit: 20, cardSlug },
          1: { cardSlug, limit: 5 },
        }),
      })
      .set('X-Forwarded-For', '203.0.113.37');
    expect(batched.status).toBe(200);
    expectNoContactLeak(batched.body);
    expect(Array.isArray(batched.body)).toBe(true);
    if (!Array.isArray(batched.body)) throw new Error('expected a batch body');
    for (const entry of batched.body) {
      const items = listingItems(entry);
      const match = items.find((item) => item.id === listingId);
      expect(match?.contact).toBeNull();
    }
  });
});
