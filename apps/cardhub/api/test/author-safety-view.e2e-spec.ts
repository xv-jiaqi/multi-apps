import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Author-only safety view (follow-up to #306).
 *
 * - REVIEW rows: only the signed-in author sees them, with `safetyStatus: 'review'`.
 *   Other users and anonymous callers never see them (fail-closed).
 * - RISKY rows: even the author only gets `safetyStatus: 'blocked'`; the
 *   response must not carry the original text.
 * - `x-cardhub-surface: miniapp` applies miniapp visibility when the input
 *   does not name a surface; an explicit `input.surface` still wins.
 */

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

function resultData(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.result)) throw new Error('expected a tRPC result');
  return body.result.data;
}

function pageItems(body: unknown): Array<Record<string, unknown>> {
  const data = resultData(body);
  if (!isRecord(data) || !Array.isArray(data.items)) throw new Error('expected { items }');
  return data.items.filter(isRecord);
}

function errorCode(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.error) || !isRecord(body.error.data)) return undefined;
  return body.error.data.code;
}

// Markers are CJK so `slugify` (ASCII only) cannot copy them into a slug.
const RISKY_TITLE = '拦截标题原文甲';
const RISKY_BODY = '拦截正文原文乙';
const RISKY_REPLY = '拦截回帖原文丙';
const RISKY_COMMENT = '拦截评论原文丁';
const RISKY_CONTACT = '拦截联系方式戊';
const RISKY_NOTE = '拦截备注原文己';
const RISKY_VARIANT = '拦截版本原文庚';
const RISKY_IMAGE = 'https://img.cardhub.test/risky-listing-image.png';
const RISKY_MARKERS = [
  RISKY_TITLE,
  RISKY_BODY,
  RISKY_REPLY,
  RISKY_COMMENT,
  RISKY_CONTACT,
  RISKY_NOTE,
  RISKY_VARIANT,
  RISKY_IMAGE,
];

function expectNoRiskyText(body: unknown) {
  const serialized = JSON.stringify(body);
  for (const marker of RISKY_MARKERS) expect(serialized).not.toContain(marker);
}

describe('author-only safety view', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const author = { token: '', id: '' };
  const other = { token: '', id: '' };
  let cardId = '';
  let cardSlug = '';
  const topics = { review: '', risky: '', unchecked: '' };
  const listings = { review: '', risky: '' };
  const comments = { review: '', risky: '' };

  async function register(identity: ReturnType<typeof nextIdentity>) {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email, username: identity.username, password: 'safety-password' });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    if (!isRecord(data) || typeof data.token !== 'string' || !isRecord(data.user)) {
      throw new Error('expected { token, user }');
    }
    const id = data.user.id;
    if (typeof id !== 'string') throw new Error('expected a user id');
    return { token: data.token, id };
  }

  function query(
    path: string,
    input: unknown,
    options: { token?: string; surfaceHeader?: string } = {},
  ) {
    let req = request(app.getHttpServer())
      .get(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`)
      .set('X-Forwarded-For', '203.0.113.77');
    if (options.token) req = req.set('Authorization', `Bearer ${options.token}`);
    if (options.surfaceHeader) req = req.set('x-cardhub-surface', options.surfaceHeader);
    return req;
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    Object.assign(author, await register(nextIdentity('sva')));
    Object.assign(other, await register(nextIdentity('svo')));

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const series = await prisma.series.create({
      data: { slug: `sv-series-${suffix}`, title: '可见性系列' },
    });
    cardSlug = `sv-card-${suffix}`;
    cardId = (
      await prisma.card.create({
        data: { slug: cardSlug, name: '可见性卡', seriesId: series.id },
        select: { id: true },
      })
    ).id;

    topics.review = (
      await prisma.topic.create({
        data: {
          slug: `sv-review-${suffix}`,
          title: '审核中的话题',
          body: '审核中的正文',
          userId: author.id,
          safetyStatus: 'REVIEW',
        },
      })
    ).slug;
    const riskyTopic = await prisma.topic.create({
      data: {
        slug: `sv-risky-${suffix}`,
        title: RISKY_TITLE,
        body: RISKY_BODY,
        userId: author.id,
        safetyStatus: 'RISKY',
      },
    });
    topics.risky = riskyTopic.slug;
    await prisma.reply.create({
      data: { topicId: riskyTopic.id, userId: author.id, body: RISKY_REPLY, safetyStatus: 'PASS' },
    });
    topics.unchecked = (
      await prisma.topic.create({
        data: {
          slug: `sv-unchecked-${suffix}`,
          title: '未检的话题',
          body: '未检的正文',
          userId: author.id,
          safetyStatus: 'UNCHECKED',
        },
      })
    ).slug;

    listings.review = (
      await prisma.listing.create({
        data: {
          userId: author.id,
          cardSlug,
          kind: 'SELL',
          contact: '审核中联系方式',
          safetyStatus: 'REVIEW',
        },
      })
    ).id;
    listings.risky = (
      await prisma.listing.create({
        data: {
          userId: author.id,
          cardSlug,
          kind: 'SELL',
          contact: RISKY_CONTACT,
          note: RISKY_NOTE,
          variantNote: RISKY_VARIANT,
          imageUrls: [RISKY_IMAGE],
          safetyStatus: 'RISKY',
        },
      })
    ).id;

    comments.review = (
      await prisma.comment.create({
        data: { userId: author.id, cardId, content: '审核中的评论', safetyStatus: 'REVIEW' },
      })
    ).id;
    comments.risky = (
      await prisma.comment.create({
        data: { userId: author.id, cardId, content: RISKY_COMMENT, safetyStatus: 'RISKY' },
      })
    ).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('forum.topics.bySlug', () => {
    it.each(['web', 'miniapp'] as const)(
      'shows a REVIEW topic only to its author (%s)',
      async (surface) => {
        const mine = await query(
          'forum.topics.bySlug',
          { slug: topics.review, surface },
          { token: author.token },
        );
        expect(mine.status).toBe(200);
        const data = resultData(mine.body);
        expect(isRecord(data) && data.safetyStatus).toBe('review');
        expect(isRecord(data) && data.body).toBe('审核中的正文');

        const others = await query(
          'forum.topics.bySlug',
          { slug: topics.review, surface },
          { token: other.token },
        );
        expect(others.status).toBe(404);
        expect(errorCode(others.body)).toBe('NOT_FOUND');

        const anonymous = await query('forum.topics.bySlug', { slug: topics.review, surface });
        expect(anonymous.status).toBe(404);
        expect(errorCode(anonymous.body)).toBe('NOT_FOUND');
      },
    );

    it.each(['web', 'miniapp'] as const)(
      'gives the author of a RISKY topic only the blocked status (%s)',
      async (surface) => {
        const mine = await query(
          'forum.topics.bySlug',
          { slug: topics.risky, surface },
          { token: author.token },
        );
        expect(mine.status).toBe(200);
        const data = resultData(mine.body);
        if (!isRecord(data)) throw new Error('expected a topic');
        expect(data.safetyStatus).toBe('blocked');
        expect(data.title).toBe('');
        expect(data.body).toBe('');
        expect(data.replies).toEqual([]);
        expect(data.replyNextCursor).toBeNull();
        expect(data.replyCount).toBe(0);
        expectNoRiskyText(mine.body);
      },
    );

    it.each(['web', 'miniapp'] as const)(
      'keeps a RISKY topic NOT_FOUND for other users and anonymous callers (%s)',
      async (surface) => {
        const others = await query(
          'forum.topics.bySlug',
          { slug: topics.risky, surface },
          { token: other.token },
        );
        expect(others.status).toBe(404);
        expect(errorCode(others.body)).toBe('NOT_FOUND');
        expectNoRiskyText(others.body);

        const anonymous = await query('forum.topics.bySlug', { slug: topics.risky, surface });
        expect(anonymous.status).toBe(404);
        expect(errorCode(anonymous.body)).toBe('NOT_FOUND');
        expectNoRiskyText(anonymous.body);
      },
    );
  });

  describe('users.myTopics', () => {
    it('labels REVIEW and blocks RISKY for the author', async () => {
      const response = await query('users.myTopics', { limit: 50 }, { token: author.token });
      expect(response.status).toBe(200);
      const items = pageItems(response.body);
      const review = items.find((item) => item.slug === topics.review);
      const risky = items.find((item) => item.slug === topics.risky);
      expect(review?.safetyStatus).toBe('review');
      expect(review?.title).toBe('审核中的话题');
      expect(risky?.safetyStatus).toBe('blocked');
      expect(risky?.title).toBe('');
      expect(risky?.replyCount).toBe(0);
      expectNoRiskyText(response.body);
    });

    it('never lists the author rows for another user or an anonymous caller', async () => {
      const others = await query('users.myTopics', { limit: 50 }, { token: other.token });
      expect(others.status).toBe(200);
      const slugs = pageItems(others.body).map((item) => item.slug);
      expect(slugs).not.toContain(topics.review);
      expect(slugs).not.toContain(topics.risky);

      const anonymous = await query('users.myTopics', { limit: 50 });
      expect(anonymous.status).toBe(401);
      expectNoRiskyText(anonymous.body);
    });
  });

  describe('users.myComments', () => {
    it('labels REVIEW and blocks RISKY for the author', async () => {
      const response = await query('users.myComments', { limit: 50 }, { token: author.token });
      expect(response.status).toBe(200);
      const items = pageItems(response.body);
      const review = items.find((item) => item.id === comments.review);
      const risky = items.find((item) => item.id === comments.risky);
      expect(review?.safetyStatus).toBe('review');
      expect(review?.body).toBe('审核中的评论');
      expect(risky?.safetyStatus).toBe('blocked');
      expect(risky?.body).toBe('');
      expectNoRiskyText(response.body);
    });

    it('never lists the author rows for another user or an anonymous caller', async () => {
      const others = await query('users.myComments', { limit: 50 }, { token: other.token });
      expect(others.status).toBe(200);
      const ids = pageItems(others.body).map((item) => item.id);
      expect(ids).not.toContain(comments.review);
      expect(ids).not.toContain(comments.risky);

      const anonymous = await query('users.myComments', { limit: 50 });
      expect(anonymous.status).toBe(401);
      expectNoRiskyText(anonymous.body);
    });
  });

  describe('listings.mine', () => {
    it('labels REVIEW and blocks RISKY for the author', async () => {
      const response = await query('listings.mine', { limit: 50 }, { token: author.token });
      expect(response.status).toBe(200);
      const items = pageItems(response.body);
      const review = items.find((item) => item.id === listings.review);
      const risky = items.find((item) => item.id === listings.risky);
      expect(review?.safetyStatus).toBe('review');
      expect(review?.contact).toBe('审核中联系方式');
      expect(risky?.safetyStatus).toBe('blocked');
      expect(risky?.contact).toBe('');
      expect(risky?.note).toBeNull();
      expect(risky?.variantNote).toBeNull();
      expect(risky?.imageUrls).toEqual([]);
      expectNoRiskyText(response.body);
    });

    it('never lists the author rows for another user or an anonymous caller', async () => {
      const others = await query('listings.mine', { limit: 50 }, { token: other.token });
      expect(others.status).toBe(200);
      const ids = pageItems(others.body).map((item) => item.id);
      expect(ids).not.toContain(listings.review);
      expect(ids).not.toContain(listings.risky);

      const anonymous = await query('listings.mine', { limit: 50 });
      expect(anonymous.status).toBe(401);
      expectNoRiskyText(anonymous.body);
    });

    it('keeps REVIEW and RISKY listings out of the public lists', async () => {
      for (const token of [undefined, other.token]) {
        const response = await query(
          'listings.byCard',
          { cardSlug, limit: 5 },
          token ? { token } : {},
        );
        expect(response.status).toBe(200);
        const data = resultData(response.body);
        const ids = Array.isArray(data) ? data.filter(isRecord).map((row) => row.id) : [];
        expect(ids).not.toContain(listings.review);
        expect(ids).not.toContain(listings.risky);
        expectNoRiskyText(response.body);
      }
    });
  });

  describe('x-cardhub-surface header', () => {
    it('applies miniapp visibility when the input omits surface', async () => {
      const web = await query('forum.topics.bySlug', { slug: topics.unchecked });
      expect(web.status).toBe(200);

      const miniapp = await query(
        'forum.topics.bySlug',
        { slug: topics.unchecked },
        { surfaceHeader: 'miniapp' },
      );
      expect(miniapp.status).toBe(404);
      expect(errorCode(miniapp.body)).toBe('NOT_FOUND');
    });

    it('lets an explicit input.surface win over the header', async () => {
      const explicit = await query(
        'forum.topics.bySlug',
        { slug: topics.unchecked, surface: 'web' },
        { surfaceHeader: 'miniapp' },
      );
      expect(explicit.status).toBe(200);
    });

    it('passes the CORS preflight for the H5 build', async () => {
      const origin = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim();
      const preflight = await request(app.getHttpServer())
        .options('/trpc/forum.topics.list')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,x-cardhub-surface');
      expect(preflight.status).toBeLessThan(300);
      expect(
        String(preflight.headers['access-control-allow-headers'] ?? '').toLowerCase(),
      ).toContain('x-cardhub-surface');
    });

    it('ignores an unknown header value and keeps the web default', async () => {
      const unknown = await query(
        'forum.topics.bySlug',
        { slug: topics.unchecked },
        { surfaceHeader: 'not-a-surface' },
      );
      expect(unknown.status).toBe(200);
    });
  });
});
