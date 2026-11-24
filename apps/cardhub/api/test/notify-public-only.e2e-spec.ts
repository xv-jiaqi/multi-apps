import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { ContentSecurityService } from '../src/modules/content-security/content-security.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Write-time notification gate: @ mentions and reply notifications go out
 * only when the new content, and the topic or parent comment it hangs on,
 * is publicly visible. Otherwise the recipient would get a row that the
 * read-time gate empties (excerpt '', href null) but that still counts as
 * unread. Asserted only through what the recipient can observe:
 * notifications.list and notifications.unreadCount.
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
  if (!isRecord(body) || !isRecord(body.result)) {
    throw new Error(`expected a tRPC result, got ${JSON.stringify(body)}`);
  }
  return body.result.data;
}

type User = { token: string; id: string; username: string };
type Surface = 'web' | 'miniapp';

describe('notifications are sent only for publicly visible content', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contentSecurity: ContentSecurityService;
  let cardSlug = '';
  let ipSeq = 0;

  async function register(label: string): Promise<User> {
    const identity = nextIdentity(label);
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email, username: identity.username, password: 'notify-password' });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    if (!isRecord(data) || typeof data.token !== 'string' || !isRecord(data.user)) {
      throw new Error('expected { token, user }');
    }
    return { token: data.token, id: String(data.user.id), username: identity.username };
  }

  async function mutate(path: string, input: unknown, user: User) {
    ipSeq += 1;
    const response = await request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', `203.0.113.${(ipSeq % 150) + 50}`)
      .set('Authorization', `Bearer ${user.token}`)
      .send(JSON.stringify(input));
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    if (!isRecord(data)) throw new Error('expected an object');
    return data;
  }

  async function inbox(user: User, surface: Surface) {
    let listReq = request(app.getHttpServer())
      .get(`/trpc/notifications.list?input=${encodeURIComponent(JSON.stringify({ limit: 50 }))}`)
      .set('Authorization', `Bearer ${user.token}`);
    let countReq = request(app.getHttpServer())
      .get('/trpc/notifications.unreadCount')
      .set('Authorization', `Bearer ${user.token}`);
    if (surface === 'miniapp') {
      listReq = listReq.set('x-cardhub-surface', 'miniapp');
      countReq = countReq.set('x-cardhub-surface', 'miniapp');
    }
    const [list, count] = await Promise.all([listReq, countReq]);
    expect(list.status).toBe(200);
    expect(count.status).toBe(200);
    const listData = resultData(list.body);
    const countData = resultData(count.body);
    if (!isRecord(listData) || !Array.isArray(listData.items) || !isRecord(countData)) {
      throw new Error('expected list and count');
    }
    return { items: listData.items as Array<Record<string, unknown>>, unread: countData.count };
  }

  async function expectEmptyInbox(user: User) {
    for (const surface of ['web', 'miniapp'] as const) {
      expect(await inbox(user, surface)).toEqual({ items: [], unread: 0 });
    }
  }

  /** The next content-safety decision says REVIEW (the write still succeeds). */
  function nextWriteIsReview() {
    jest.spyOn(contentSecurity, 'evaluateWrite').mockResolvedValueOnce({
      safetyStatus: 'REVIEW',
      textResult: 'review',
      excerpt: '',
      pendingMedia: [],
      openid: null,
    });
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    contentSecurity = app.get(ContentSecurityService);
    const suffix = Date.now().toString(36);
    const series = await prisma.series.create({
      data: { slug: `npo-series-${suffix}`, title: '通知公开系列' },
    });
    cardSlug = `npo-card-${suffix}`;
    await prisma.card.create({
      data: { slug: cardSlug, name: '通知公开卡', seriesId: series.id },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('card comment replies', () => {
    it('author replying to their own REVIEW parent with an @ sends nothing', async () => {
      const author = await register('npoa');
      const mentioned = await register('npob');
      const parent = await mutate('comments.create', { cardSlug, content: '父评论' }, author);
      await prisma.comment.update({
        where: { id: String(parent.id) },
        data: { safetyStatus: 'REVIEW' },
      });
      await mutate(
        'comments.create',
        { cardSlug, content: `补充 @${mentioned.username}`, parentId: parent.id },
        author,
      );
      await expectEmptyInbox(mentioned);
    });

    it('a REVIEW reply on a public parent sends neither the mention nor the reply notice', async () => {
      const parentAuthor = await register('npop');
      const replier = await register('npor');
      const mentioned = await register('npom');
      const parent = await mutate(
        'comments.create',
        { cardSlug, content: '公开父评论' },
        parentAuthor,
      );
      nextWriteIsReview();
      await mutate(
        'comments.create',
        { cardSlug, content: `回复 @${mentioned.username}`, parentId: parent.id },
        replier,
      );
      await expectEmptyInbox(mentioned);
      await expectEmptyInbox(parentAuthor);
    });

    it('a REVIEW top-level comment with an @ sends nothing', async () => {
      const author = await register('npot');
      const mentioned = await register('npou');
      nextWriteIsReview();
      await mutate('comments.create', { cardSlug, content: `顶层 @${mentioned.username}` }, author);
      await expectEmptyInbox(mentioned);
    });

    it('control: a public parent and reply still notify the mention and the parent author', async () => {
      const parentAuthor = await register('npoc');
      const replier = await register('npod');
      const mentioned = await register('npoe');
      const parent = await mutate(
        'comments.create',
        { cardSlug, content: '公开父评论' },
        parentAuthor,
      );
      await mutate(
        'comments.create',
        { cardSlug, content: `回复 @${mentioned.username}`, parentId: parent.id },
        replier,
      );
      const web = await inbox(mentioned, 'web');
      expect(web.unread).toBe(1);
      expect(web.items[0]).toMatchObject({ type: 'MENTION' });
      expect(String(web.items[0]?.excerpt)).toContain('回复');
      expect((await inbox(parentAuthor, 'web')).items[0]).toMatchObject({ type: 'COMMENT_REPLY' });
    });
  });

  describe('forum topics', () => {
    async function topic(author: User, body: string) {
      return mutate('forum.topics.create', { title: `通知话题 ${ipSeq}`, body }, author);
    }

    it.each(['RISKY', 'REVIEW'] as const)(
      'editing a %s topic to add an @ sends nothing',
      async (status) => {
        const author = await register('npfa');
        const mentioned = await register('npfb');
        const created = await topic(author, '还没有提及');
        await prisma.topic.update({
          where: { id: String(created.id) },
          data: { safetyStatus: status },
        });
        await mutate(
          'forum.topics.update',
          { id: created.id, title: '改过的标题', body: `加上 @${mentioned.username}` },
          author,
        );
        await expectEmptyInbox(mentioned);
      },
    );

    it('a topic written as REVIEW with an @ sends nothing', async () => {
      const author = await register('npfc');
      const mentioned = await register('npfd');
      nextWriteIsReview();
      await topic(author, `新话题 @${mentioned.username}`);
      await expectEmptyInbox(mentioned);
    });

    it('a reply on the author own REVIEW topic with an @ sends nothing', async () => {
      const author = await register('npfe');
      const mentioned = await register('npff');
      const created = await topic(author, '审核中的话题');
      await prisma.topic.update({
        where: { id: String(created.id) },
        data: { safetyStatus: 'REVIEW' },
      });
      await mutate(
        'forum.replies.create',
        { topicId: created.id, body: `楼主补充 @${mentioned.username}` },
        author,
      );
      await expectEmptyInbox(mentioned);
    });

    it('a REVIEW reply on a public topic sends neither the mention nor the topic-reply notice', async () => {
      const author = await register('npfg');
      const replier = await register('npfh');
      const mentioned = await register('npfi');
      const created = await topic(author, '公开话题');
      nextWriteIsReview();
      await mutate(
        'forum.replies.create',
        { topicId: created.id, body: `回帖 @${mentioned.username}` },
        replier,
      );
      await expectEmptyInbox(mentioned);
      await expectEmptyInbox(author);
    });

    it('control: editing a public topic to add an @ still notifies', async () => {
      const author = await register('npfj');
      const mentioned = await register('npfk');
      const created = await topic(author, '还没有提及');
      await mutate(
        'forum.topics.update',
        { id: created.id, title: '改过的标题', body: `加上 @${mentioned.username}` },
        author,
      );
      for (const surface of ['web', 'miniapp'] as const) {
        const box = await inbox(mentioned, surface);
        expect(box.unread).toBe(1);
        expect(box.items).toHaveLength(1);
        expect(box.items[0]).toMatchObject({ type: 'MENTION' });
      }
    });
  });
});
