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
/** Unique per run, so reply-count checks do not see rows from earlier runs. */
const RUN = Date.now().toString(36);

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

function pickCounts(data: Record<string, unknown>) {
  return {
    listingTotalCount: data.listingTotalCount,
    topicCount: data.topicCount,
    commentCount: data.commentCount,
    replyCount: data.replyCount,
  };
}

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
    if (options.surfaceHeader !== undefined) {
      req = req.set('x-cardhub-surface', options.surfaceHeader);
    }
    return req;
  }

  function mutate(
    path: string,
    input: unknown,
    options: { token?: string; surfaceHeader?: string } = {},
  ) {
    let req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.78');
    if (options.token) req = req.set('Authorization', `Bearer ${options.token}`);
    if (options.surfaceHeader !== undefined) {
      req = req.set('x-cardhub-surface', options.surfaceHeader);
    }
    return req.send(JSON.stringify(input));
  }

  const topicIds = { review: '', risky: '' };

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

    const reviewTopic = await prisma.topic.create({
      data: {
        slug: `sv-review-${suffix}`,
        title: '审核中的话题',
        body: '审核中的正文',
        userId: author.id,
        safetyStatus: 'REVIEW',
      },
    });
    topics.review = reviewTopic.slug;
    topicIds.review = reviewTopic.id;
    await prisma.reply.create({
      data: {
        topicId: reviewTopic.id,
        userId: other.id,
        body: '审核中话题下的回帖',
        safetyStatus: 'PASS',
      },
    });
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
    topicIds.risky = riskyTopic.id;
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

    it.each([
      ['input surface', { surface: 'miniapp' }, {}],
      ['surface header', {}, { surfaceHeader: 'miniapp' }],
    ] as const)(
      'gives the author of a RISKY topic only the blocked status on miniapp (%s)',
      async (_label, extraInput, extraOptions) => {
        const mine = await query(
          'forum.topics.bySlug',
          { slug: topics.risky, ...extraInput },
          { token: author.token, ...extraOptions },
        );
        expect(mine.status).toBe(200);
        const data = resultData(mine.body);
        if (!isRecord(data)) throw new Error('expected a topic');
        expect(data.safetyStatus).toBe('blocked');
        expect(data.title).toBe('');
        expect(data.excerpt).toBe('');
        expect(data.body).toBe('');
        expect(data.replies).toEqual([]);
        expect(data.replyNextCursor).toBeNull();
        expect(data.replyCount).toBe(0);
        expectNoRiskyText(mine.body);
      },
    );

    it.each([
      ['explicit web', { surface: 'web' }],
      ['default web', {}],
    ] as const)(
      'keeps the author RISKY topic NOT_FOUND on web (%s)',
      async (_label, extraInput) => {
        const mine = await query(
          'forum.topics.bySlug',
          { slug: topics.risky, ...extraInput },
          { token: author.token },
        );
        expect(mine.status).toBe(404);
        expect(errorCode(mine.body)).toBe('NOT_FOUND');
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
    it('leaves the author RISKY rows out on web and keeps REVIEW', async () => {
      for (const extraInput of [{}, { surface: 'web' }]) {
        const response = await query(
          'users.myTopics',
          { limit: 50, ...extraInput },
          { token: author.token },
        );
        expect(response.status).toBe(200);
        const items = pageItems(response.body);
        const keys = items.map((item) => item.slug);
        expect(keys).toContain(topics.review);
        expect(keys).not.toContain(topics.risky);
        expect(items.some((item) => item.safetyStatus === 'blocked')).toBe(false);
        expectNoRiskyText(response.body);
      }
    });

    it('blocks RISKY for the author when the input names miniapp', async () => {
      const response = await query(
        'users.myTopics',
        { limit: 50, surface: 'miniapp' },
        { token: author.token },
      );
      expect(response.status).toBe(200);
      const risky = pageItems(response.body).find((item) => item.slug === topics.risky);
      expect(risky?.safetyStatus).toBe('blocked');
      expectNoRiskyText(response.body);
    });

    it('labels REVIEW and blocks RISKY for the author on miniapp', async () => {
      const response = await query(
        'users.myTopics',
        { limit: 50 },
        { token: author.token, surfaceHeader: 'miniapp' },
      );
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
    it('leaves the author RISKY rows out on web and keeps REVIEW', async () => {
      for (const extraInput of [{}, { surface: 'web' }]) {
        const response = await query(
          'users.myComments',
          { limit: 50, ...extraInput },
          { token: author.token },
        );
        expect(response.status).toBe(200);
        const items = pageItems(response.body);
        const keys = items.map((item) => item.id);
        expect(keys).toContain(comments.review);
        expect(keys).not.toContain(comments.risky);
        expect(items.some((item) => item.safetyStatus === 'blocked')).toBe(false);
        expectNoRiskyText(response.body);
      }
    });

    it('blocks RISKY for the author when the input names miniapp', async () => {
      const response = await query(
        'users.myComments',
        { limit: 50, surface: 'miniapp' },
        { token: author.token },
      );
      expect(response.status).toBe(200);
      const risky = pageItems(response.body).find((item) => item.id === comments.risky);
      expect(risky?.safetyStatus).toBe('blocked');
      expectNoRiskyText(response.body);
    });

    it('labels REVIEW and blocks RISKY for the author on miniapp', async () => {
      const response = await query(
        'users.myComments',
        { limit: 50 },
        { token: author.token, surfaceHeader: 'miniapp' },
      );
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
    it('leaves the author RISKY rows out on web and keeps REVIEW', async () => {
      for (const extraInput of [{}, { surface: 'web' }]) {
        const response = await query(
          'listings.mine',
          { limit: 50, ...extraInput },
          { token: author.token },
        );
        expect(response.status).toBe(200);
        const items = pageItems(response.body);
        const keys = items.map((item) => item.id);
        expect(keys).toContain(listings.review);
        expect(keys).not.toContain(listings.risky);
        expect(items.some((item) => item.safetyStatus === 'blocked')).toBe(false);
        expectNoRiskyText(response.body);
      }
    });

    it('blocks RISKY for the author when the input names miniapp', async () => {
      const response = await query(
        'listings.mine',
        { limit: 50, surface: 'miniapp' },
        { token: author.token },
      );
      expect(response.status).toBe(200);
      const risky = pageItems(response.body).find((item) => item.id === listings.risky);
      expect(risky?.safetyStatus).toBe('blocked');
      expectNoRiskyText(response.body);
    });

    it('labels REVIEW and blocks RISKY for the author on miniapp', async () => {
      const response = await query(
        'listings.mine',
        { limit: 50 },
        { token: author.token, surfaceHeader: 'miniapp' },
      );
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

  describe('forum.replies.list and replies.create follow the topic visibility', () => {
    const emptyPage = { items: [], nextCursor: null };
    const viewers = [
      ['author', () => author.token],
      ['other user', () => other.token],
      ['anonymous', () => undefined],
    ] as const;

    it.each(['web', 'miniapp'] as const)(
      'lists nothing for a RISKY topic, for every viewer (%s)',
      async (surface) => {
        for (const [, token] of viewers) {
          const t = token();
          const response = await query(
            'forum.replies.list',
            { topicId: topicIds.risky, limit: 20, surface },
            t ? { token: t } : {},
          );
          expect(response.status).toBe(200);
          expect(resultData(response.body)).toEqual(emptyPage);
          expectNoRiskyText(response.body);
        }
      },
    );

    it.each(['web', 'miniapp'] as const)(
      'lists a REVIEW topic replies for its author only (%s)',
      async (surface) => {
        const mine = await query(
          'forum.replies.list',
          { topicId: topicIds.review, limit: 20, surface },
          { token: author.token },
        );
        expect(mine.status).toBe(200);
        const bodies = pageItems(mine.body).map((item) => item.body);
        expect(bodies).toContain('审核中话题下的回帖');

        for (const t of [other.token, undefined]) {
          const response = await query(
            'forum.replies.list',
            { topicId: topicIds.review, limit: 20, surface },
            t ? { token: t } : {},
          );
          expect(response.status).toBe(200);
          expect(resultData(response.body)).toEqual(emptyPage);
        }
      },
    );

    it('answers a hidden topic exactly like a missing topic', async () => {
      const missing = await query('forum.replies.list', {
        topicId: '00000000-0000-4000-8000-000000000000',
        limit: 20,
      });
      const hidden = await query(
        'forum.replies.list',
        { topicId: topicIds.review, limit: 20 },
        { token: other.token },
      );
      expect(hidden.status).toBe(missing.status);
      expect(hidden.body).toEqual(missing.body);
    });

    it.each([
      ['web', undefined],
      ['miniapp', 'miniapp'],
    ] as const)('refuses replies to a RISKY topic for every viewer (%s)', async (_s, header) => {
      for (const t of [author.token, other.token]) {
        const response = await mutate(
          'forum.replies.create',
          { topicId: topicIds.risky, body: `想回一个被拦截的话题 ${RUN}` },
          header ? { token: t, surfaceHeader: header } : { token: t },
        );
        expect(response.status).toBe(404);
        expect(errorCode(response.body)).toBe('NOT_FOUND');
      }
      const anonymous = await mutate(
        'forum.replies.create',
        { topicId: topicIds.risky, body: `想回一个被拦截的话题 ${RUN}` },
        header ? { surfaceHeader: header } : {},
      );
      expect(anonymous.status).toBe(401);
      expect(await prisma.reply.count({ where: { body: `想回一个被拦截的话题 ${RUN}` } })).toBe(0);
    });

    it('lets only the author reply to a REVIEW topic', async () => {
      const others = await mutate(
        'forum.replies.create',
        { topicId: topicIds.review, body: `别人回审核中的话题 ${RUN}` },
        { token: other.token },
      );
      expect(others.status).toBe(404);
      expect(errorCode(others.body)).toBe('NOT_FOUND');

      const anonymous = await mutate('forum.replies.create', {
        topicId: topicIds.review,
        body: `未登录回审核中的话题 ${RUN}`,
      });
      expect(anonymous.status).toBe(401);

      const mine = await mutate(
        'forum.replies.create',
        { topicId: topicIds.review, body: `作者回自己审核中的话题 ${RUN}` },
        { token: author.token },
      );
      expect(mine.status).toBe(200);
      expect(await prisma.reply.count({ where: { body: `别人回审核中的话题 ${RUN}` } })).toBe(0);
    });
  });

  describe('users.me counts match the "my" lists on each surface', () => {
    async function me(input: unknown, surfaceHeader?: string) {
      let req = request(app.getHttpServer())
        .get(
          input === undefined
            ? '/trpc/users.me'
            : `/trpc/users.me?input=${encodeURIComponent(JSON.stringify(input))}`,
        )
        .set('Authorization', `Bearer ${author.token}`);
      if (surfaceHeader !== undefined) req = req.set('x-cardhub-surface', surfaceHeader);
      const response = await req;
      expect(response.status).toBe(200);
      const data = resultData(response.body);
      if (!isRecord(data)) throw new Error('expected users.me');
      return data;
    }

    async function listLength(path: string, surface: 'web' | 'miniapp') {
      const response = await query(path, { limit: 50, surface }, { token: author.token });
      expect(response.status).toBe(200);
      return pageItems(response.body).length;
    }

    it('counts what listings.mine / myTopics / myComments return', async () => {
      // A RISKY reply too, so replyCount follows the same rule.
      await prisma.reply.create({
        data: {
          topicId: topicIds.risky,
          userId: author.id,
          body: RISKY_REPLY,
          safetyStatus: 'RISKY',
        },
      });
      const riskyReplies = await prisma.reply.count({
        where: { userId: author.id, safetyStatus: 'RISKY' },
      });
      const allReplies = await prisma.reply.count({ where: { userId: author.id } });

      const cases = [
        ['web', 'no input', () => me(undefined)],
        ['web', 'input web', () => me({ surface: 'web' })],
        ['web', 'header web', () => me(undefined, 'web')],
        ['miniapp', 'input miniapp', () => me({ surface: 'miniapp' })],
        ['miniapp', 'header miniapp', () => me(undefined, 'miniapp')],
        ['miniapp', 'header miniapp + input web', () => me({ surface: 'web' }, 'miniapp')],
      ] as const;
      for (const [surface, label, load] of cases) {
        const counts = await load();
        const expected = {
          listingTotalCount: await listLength('listings.mine', surface),
          topicCount: await listLength('users.myTopics', surface),
          commentCount: await listLength('users.myComments', surface),
          replyCount: surface === 'web' ? allReplies - riskyReplies : allReplies,
        };
        expect({ label, ...pickCounts(counts) }).toEqual({ label, ...expected });
      }

      const web = await me(undefined);
      const mini = await me({ surface: 'miniapp' });
      expect(Number(mini.topicCount) - Number(web.topicCount)).toBe(1);
      expect(Number(mini.commentCount) - Number(web.commentCount)).toBe(1);
      expect(Number(mini.listingTotalCount) - Number(web.listingTotalCount)).toBe(1);
      expect(Number(mini.listingCount) - Number(web.listingCount)).toBe(1);
      expect(Number(mini.replyCount) - Number(web.replyCount)).toBe(riskyReplies);
    });
  });

  describe('blocked rows keep the normal row shape', () => {
    function keysOf(row: Record<string, unknown> | undefined) {
      if (!row) throw new Error('expected a row');
      return Object.keys(row).sort();
    }

    it.each([
      ['users.myTopics', 'slug', () => topics],
      ['users.myComments', 'id', () => comments],
      ['listings.mine', 'id', () => listings],
    ] as const)('%s', async (path, key, ids) => {
      const response = await query(
        path,
        { limit: 50 },
        { token: author.token, surfaceHeader: 'miniapp' },
      );
      const items = pageItems(response.body);
      const review = items.find((item) => item[key] === ids().review);
      const risky = items.find((item) => item[key] === ids().risky);
      expect(risky?.safetyStatus).toBe('blocked');
      expect(keysOf(risky)).toEqual(keysOf(review));
    });

    it('forum.topics.bySlug', async () => {
      const review = await query(
        'forum.topics.bySlug',
        { slug: topics.review },
        { token: author.token, surfaceHeader: 'miniapp' },
      );
      const risky = await query(
        'forum.topics.bySlug',
        { slug: topics.risky },
        { token: author.token, surfaceHeader: 'miniapp' },
      );
      const reviewData = resultData(review.body);
      const riskyData = resultData(risky.body);
      if (!isRecord(reviewData) || !isRecord(riskyData)) throw new Error('expected topics');
      expect(riskyData.safetyStatus).toBe('blocked');
      expect(keysOf(riskyData)).toEqual(keysOf(reviewData));
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

    it.each([
      ['header miniapp, input web', { surface: 'web' }, 'miniapp'],
      ['header web, input miniapp', { surface: 'miniapp' }, 'web'],
    ] as const)('takes the stricter surface (%s)', async (_label, extraInput, header) => {
      const response = await query(
        'forum.topics.bySlug',
        { slug: topics.unchecked, ...extraInput },
        { surfaceHeader: header },
      );
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('NOT_FOUND');
    });

    it('lets a miniapp author keep the blocked view when the input says web', async () => {
      const response = await query(
        'users.myTopics',
        { limit: 50, surface: 'web' },
        { token: author.token, surfaceHeader: 'miniapp' },
      );
      expect(response.status).toBe(200);
      const risky = pageItems(response.body).find((item) => item.slug === topics.risky);
      expect(risky?.safetyStatus).toBe('blocked');
      expectNoRiskyText(response.body);
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

    it.each(['not-a-surface', '', 'WEB', 'web,web'])(
      'treats an invalid header value %j as miniapp',
      async (header) => {
        const response = await query(
          'forum.topics.bySlug',
          { slug: topics.unchecked },
          { surfaceHeader: header },
        );
        expect(response.status).toBe(404);
        expect(errorCode(response.body)).toBe('NOT_FOUND');
      },
    );
  });
});
