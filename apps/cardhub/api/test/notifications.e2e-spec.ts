import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_ERROR_CODES, t } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { subscribeLogLines } from '../src/bootstrap/http-logger';
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

function expectString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected a result object');
  }
  return body.result.data;
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('expected a list');
  const rows: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!isRecord(item)) throw new Error('expected a row');
    rows.push(item);
  }
  return rows;
}

describe('notifications', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ip = 20;

  function nextIp(): string {
    ip += 1;
    return `203.0.113.${ip}`;
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, body: unknown, token?: string, forwardedFor = nextIp()) {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', forwardedFor);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function get(path: string, input: unknown, token?: string, forwardedFor = nextIp()) {
    const req = request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .set('X-Forwarded-For', forwardedFor);
    if (input !== undefined) req.query({ input: JSON.stringify(input) });
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
        password: 'notify-password',
      });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (!isRecord(user)) throw new Error('expected a user');
    return { token: expectString(data.token), id: expectString(user.id) };
  }

  async function list(token: string) {
    const response = await get('notifications.list', { limit: 50 }, token);
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    return rowsOf(data.items);
  }

  it('gives each trigger one notification and keeps the other user out', async () => {
    const alice = nextIdentity('ntalice');
    const bob = nextIdentity('ntbob');
    const cara = nextIdentity('ntcara');
    const dana = nextIdentity('ntdana');
    const erin = nextIdentity('nterin');
    const admin = nextIdentity('ntadmin');
    const aliceUser = await register(alice);
    const bobUser = await register(bob);
    const caraUser = await register(cara);
    const danaUser = await register(dana);
    const erinUser = await register(erin);
    const adminUser = await register(admin);
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'admin' } });

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const seriesSlug = `nt-series-${suffix}`.slice(0, 64);
    const cardSlug = `nt-card-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({ data: { slug: seriesSlug, title: '通知系列' } });
    await prisma.card.create({ data: { slug: cardSlug, name: '通知卡', seriesId: series.id } });

    const topic = await post(
      'forum.topics.create',
      { title: '通知话题', body: '没有提及' },
      aliceUser.token,
    );
    expect(topic.status).toBe(200);
    const topicId = expectString(resultData(topic.body).id);
    const topicSlug = expectString(resultData(topic.body).slug);

    const reply = await post(
      'forum.replies.create',
      { topicId, body: '第一条回复' },
      bobUser.token,
    );
    expect(reply.status).toBe(200);
    const replyId = expectString(resultData(reply.body).id);
    const topicReply = await prisma.notification.findMany({ where: { targetId: replyId } });
    expect(topicReply).toHaveLength(1);
    expect(topicReply[0]).toMatchObject({
      userId: aliceUser.id,
      actorId: bobUser.id,
      type: 'TOPIC_REPLY',
      action: null,
      href: `/forum/${topicSlug}#reply-${replyId}`,
    });

    const selfReply = await post(
      'forum.replies.create',
      { topicId, body: '自己回复 @' + alice.username },
      aliceUser.token,
    );
    expect(selfReply.status).toBe(200);
    const selfReplyId = expectString(resultData(selfReply.body).id);
    expect(await prisma.notification.count({ where: { targetId: selfReplyId } })).toBe(0);

    const both = await post(
      'forum.replies.create',
      {
        topicId,
        body: `也 @${alice.username} 一下 @${cara.username} @${alice.username} @ghostuser`,
      },
      bobUser.token,
    );
    expect(both.status).toBe(200);
    const bothId = expectString(resultData(both.body).id);
    const bothRows = await prisma.notification.findMany({ where: { targetId: bothId } });
    expect(bothRows.map((row) => [row.userId, row.type]).sort()).toEqual(
      [
        [aliceUser.id, 'TOPIC_REPLY'],
        [caraUser.id, 'MENTION'],
      ].sort(),
    );

    const coded = await post(
      'forum.replies.create',
      {
        topicId,
        body: ['```', `@${cara.username}`, '```', `外面 @${dana.username}`].join('\n'),
      },
      bobUser.token,
    );
    expect(coded.status).toBe(200);
    const codedId = expectString(resultData(coded.body).id);
    const codedRows = await prisma.notification.findMany({ where: { targetId: codedId } });
    expect(codedRows.map((row) => [row.userId, row.type]).sort()).toEqual(
      [
        [aliceUser.id, 'TOPIC_REPLY'],
        [danaUser.id, 'MENTION'],
      ].sort(),
    );

    const mentionedTopic = await post(
      'forum.topics.create',
      { title: `@${cara.username}`, body: `正文里 @${alice.username}` },
      bobUser.token,
    );
    expect(mentionedTopic.status).toBe(200);
    const mentionedTopicId = expectString(resultData(mentionedTopic.body).id);
    const mentionedSlug = expectString(resultData(mentionedTopic.body).slug);
    const topicMentions = await prisma.notification.findMany({
      where: { targetId: mentionedTopicId },
    });
    expect(topicMentions).toEqual([
      expect.objectContaining({
        userId: aliceUser.id,
        type: 'MENTION',
        href: `/forum/${mentionedSlug}`,
      }),
    ]);

    const edited = await post(
      'forum.topics.update',
      {
        id: mentionedTopicId,
        title: '改过的标题',
        body: `正文里 @${alice.username} @${dana.username}`,
      },
      bobUser.token,
    );
    expect(edited.status).toBe(200);
    const editedRows = await prisma.notification.findMany({
      where: { targetId: mentionedTopicId },
      orderBy: { createdAt: 'asc' },
    });
    expect(editedRows.map((row) => row.userId)).toEqual([aliceUser.id, danaUser.id]);

    const top = await post('comments.create', { cardSlug, content: '卡牌评论' }, aliceUser.token);
    expect(top.status).toBe(200);
    const topId = expectString(resultData(top.body).id);

    const cardReply = await post(
      'comments.create',
      { cardSlug, content: `@${alice.username} @${cara.username} 回复`, parentId: topId },
      bobUser.token,
    );
    expect(cardReply.status).toBe(200);
    const cardReplyId = expectString(resultData(cardReply.body).id);

    const replyHref = `/cards/${cardSlug}?parentId=${topId}#reply-${cardReplyId}`;
    const oldReplyHref = `/cards/${cardSlug}#reply-${cardReplyId}`;
    const cardReplyRows = await prisma.notification.findMany({ where: { targetId: cardReplyId } });
    expect(cardReplyRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: aliceUser.id,
          type: 'COMMENT_REPLY',
          href: replyHref,
        }),
        expect.objectContaining({
          userId: caraUser.id,
          type: 'MENTION',
          href: replyHref,
        }),
      ]),
    );
    const aliceReplyRow = cardReplyRows.find((row) => row.userId === aliceUser.id);
    if (!aliceReplyRow) throw new Error('expected Alice comment-reply notification');
    await prisma.notification.update({
      where: { id: aliceReplyRow.id },
      data: { href: oldReplyHref },
    });
    const listedReply = (await list(aliceUser.token)).find((item) => item.id === aliceReplyRow.id);
    expect(listedReply).toMatchObject({
      type: 'COMMENT_REPLY',
      href: replyHref,
      parentId: topId,
      excerpt: aliceReplyRow.excerpt,
    });
    expect(
      (
        await prisma.notification.findUnique({
          where: { id: aliceReplyRow.id },
          select: { href: true },
        })
      )?.href,
    ).toBe(oldReplyHref);
    const listedMention = (await list(caraUser.token)).find(
      (item) => item.href === replyHref && item.type === 'MENTION',
    );
    expect(listedMention).toMatchObject({ parentId: topId });

    const mailed = await post(
      'comments.create',
      { cardSlug, content: `mail a@${cara.username}.com 不是提及` },
      bobUser.token,
    );
    expect(mailed.status).toBe(200);
    expect(
      await prisma.notification.count({
        where: { targetId: expectString(resultData(mailed.body).id) },
      }),
    ).toBe(0);

    const danaComment = await post(
      'comments.create',
      { cardSlug, content: `@${dana.username} 提到你` },
      bobUser.token,
    );
    expect(danaComment.status).toBe(200);
    const danaCommentId = expectString(resultData(danaComment.body).id);
    expect(
      await prisma.notification.findFirst({ where: { targetId: danaCommentId } }),
    ).toMatchObject({
      userId: danaUser.id,
      type: 'MENTION',
      href: `/cards/${cardSlug}#comment-${danaCommentId}`,
    });
    const listedTop = (await list(danaUser.token)).find((item) =>
      String(item.href).endsWith(`#comment-${danaCommentId}`),
    );
    if (!listedTop) throw new Error('expected Dana top-level mention');
    expect(listedTop).not.toHaveProperty('parentId');

    const selfMention = await post(
      'comments.create',
      { cardSlug, content: `@${alice.username} 自己` },
      aliceUser.token,
    );
    expect(selfMention.status).toBe(200);
    expect(
      await prisma.notification.count({
        where: { targetId: expectString(resultData(selfMention.body).id) },
      }),
    ).toBe(0);

    const seriesComment = await post(
      'comments.createForSeries',
      { seriesSlug, content: `系列里 @${alice.username}` },
      bobUser.token,
    );
    expect(seriesComment.status).toBe(200);
    const seriesCommentId = expectString(resultData(seriesComment.body).id);
    expect(
      await prisma.notification.findFirst({ where: { targetId: seriesCommentId } }),
    ).toMatchObject({
      userId: aliceUser.id,
      type: 'MENTION',
      href: `/series/${seriesSlug}#comment-${seriesCommentId}`,
    });

    const longReply = await post(
      'comments.create',
      { cardSlug, content: `${'字'.repeat(90)} @${cara.username}`, parentId: topId },
      bobUser.token,
    );
    expect(longReply.status).toBe(200);
    const longId = expectString(resultData(longReply.body).id);
    const longRow = await prisma.notification.findFirst({
      where: { targetId: longId, userId: aliceUser.id },
    });
    expect(longRow?.excerpt).toBe('字'.repeat(80));

    const listing = await post(
      'listings.publish',
      { cardSlug, kind: 'SELL', contact: 'wechat-notify', note: '出售说明' },
      aliceUser.token,
    );
    expect(listing.status).toBe(200);
    const listingId = expectString(resultData(listing.body).id);
    const listingReport = await post(
      'reports.create',
      { targetType: 'LISTING', targetId: listingId, reason: '价格不合理需要看' },
      bobUser.token,
    );
    expect(listingReport.status).toBe(200);
    const marked = await post(
      'reports.resolve',
      {
        id: expectString(resultData(listingReport.body).id),
        action: 'MARK_RESOLVED',
        resolution: 'SECRET_RESOLUTION_TEXT',
      },
      adminUser.token,
    );
    expect(marked.status).toBe(200);
    const markedRow = await prisma.notification.findFirst({
      where: { targetId: listingId, type: 'CONTENT_RESOLVED' },
    });
    expect(markedRow).toMatchObject({
      userId: aliceUser.id,
      actorId: null,
      action: 'MARK_RESOLVED',
      href: `/cards/${cardSlug}`,
      excerpt: '出售说明',
    });

    const removeReport = await post(
      'reports.create',
      { targetType: 'COMMENT', targetId: topId, reason: '这条评论需要删除' },
      bobUser.token,
    );
    expect(removeReport.status).toBe(200);
    const removed = await post(
      'reports.resolve',
      {
        id: expectString(resultData(removeReport.body).id),
        action: 'REMOVE_TARGET',
        resolution: 'SECRET_RESOLUTION_TEXT',
      },
      adminUser.token,
    );
    expect(removed.status).toBe(200);
    const removedRow = await prisma.notification.findFirst({
      where: { targetId: topId, type: 'CONTENT_RESOLVED' },
    });
    expect(removedRow).toMatchObject({
      userId: aliceUser.id,
      actorId: null,
      action: 'REMOVE_TARGET',
      href: null,
    });
    expect(removedRow?.excerpt).toBe('卡牌评论');
    expect(
      await prisma.notification.count({ where: { userId: bobUser.id, type: 'CONTENT_RESOLVED' } }),
    ).toBe(0);

    const erinReply = await post(
      'forum.replies.create',
      { topicId, body: '临时用户的回复' },
      erinUser.token,
    );
    expect(erinReply.status).toBe(200);
    const erinReplyId = expectString(resultData(erinReply.body).id);
    await prisma.user.delete({ where: { id: erinUser.id } });
    const afterDelete = await prisma.notification.findFirst({ where: { targetId: erinReplyId } });
    expect(afterDelete?.actorId).toBeNull();
    expect(afterDelete?.userId).toBe(aliceUser.id);

    const notificationFindMany = jest.spyOn(prisma.notification, 'findMany');
    const commentFindMany = jest.spyOn(prisma.comment, 'findMany');
    const replyFindMany = jest.spyOn(prisma.reply, 'findMany');
    const topicFindMany = jest.spyOn(prisma.topic, 'findMany');
    const listingFindMany = jest.spyOn(prisma.listing, 'findMany');
    notificationFindMany.mockClear();
    commentFindMany.mockClear();
    replyFindMany.mockClear();
    topicFindMany.mockClear();
    listingFindMany.mockClear();
    const aliceItems = await list(aliceUser.token);
    expect(notificationFindMany).toHaveBeenCalledTimes(1);
    expect(commentFindMany.mock.calls.length).toBeLessThanOrEqual(1);
    expect(replyFindMany.mock.calls.length).toBeLessThanOrEqual(1);
    expect(topicFindMany.mock.calls.length).toBeLessThanOrEqual(1);
    expect(listingFindMany.mock.calls.length).toBeLessThanOrEqual(1);
    const targetLookups =
      commentFindMany.mock.calls.length +
      replyFindMany.mock.calls.length +
      topicFindMany.mock.calls.length +
      listingFindMany.mock.calls.length;
    expect(targetLookups).toBeLessThan(aliceItems.length);
    notificationFindMany.mockRestore();
    commentFindMany.mockRestore();
    replyFindMany.mockRestore();
    topicFindMany.mockRestore();
    listingFindMany.mockRestore();

    const bobItems = await list(bobUser.token);
    const aliceIds = new Set(aliceItems.map((item) => item.id));
    expect(bobItems.every((item) => !aliceIds.has(item.id))).toBe(true);
    const moderation = aliceItems.find((item) => item.id === markedRow?.id);
    expect(moderation).toMatchObject({
      type: 'CONTENT_RESOLVED',
      actor: null,
      action: 'MARK_RESOLVED',
      href: `/cards/${cardSlug}`,
    });
    expect(JSON.stringify(moderation)).not.toContain('SECRET_RESOLUTION_TEXT');
    expect(JSON.stringify(moderation)).not.toContain(admin.username);
    const deletedItem = aliceItems.find((item) => item.id === removedRow?.id);
    expect(deletedItem).toMatchObject({ href: null, action: 'REMOVE_TARGET' });
    const erinItem = aliceItems.find((item) => item.id === afterDelete?.id);
    expect(erinItem?.actor).toBeNull();
    expect(erinItem?.href).toBeNull();

    const countSpy = jest.spyOn(prisma.notification, 'count');
    countSpy.mockClear();
    const unread = await get('notifications.unreadCount', undefined, aliceUser.token);
    expect(unread.status).toBe(200);
    expect(resultData(unread.body).count).toBe(aliceItems.length);
    expect(countSpy).toHaveBeenCalledTimes(1);
    expect(countSpy.mock.calls[0]?.[0]).toEqual({
      where: { userId: aliceUser.id, readAt: null },
    });
    countSpy.mockRestore();

    const indexRows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'
    `;
    const indexNames = indexRows.map((row) => row.indexname);
    expect(indexNames).toContain('notifications_userId_readAt_idx');
    expect(indexNames).toContain('notifications_userId_createdAt_id_idx');
    const unreadPlan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN SELECT count(*) FROM notifications
        WHERE "userId" = ${aliceUser.id} AND "readAt" IS NULL
      `;
    });
    const planText = unreadPlan.map((row) => row['QUERY PLAN']).join('\n');
    expect(planText).toMatch(/Index (?:Only )?Scan/);
    expect(planText).not.toContain('Seq Scan');

    const firstId = expectString(aliceItems[0]?.id);
    const read = await post('notifications.markRead', { id: firstId }, aliceUser.token);
    expect(read.status).toBe(200);
    expect(resultData(read.body)).toEqual({ ok: true });
    const stored = await prisma.notification.findUnique({ where: { id: firstId } });
    expect(stored?.readAt).not.toBeNull();
    const readAgain = await post('notifications.markRead', { id: firstId }, aliceUser.token);
    expect(readAgain.status).toBe(200);
    const storedAgain = await prisma.notification.findUnique({ where: { id: firstId } });
    expect(storedAgain?.readAt?.toISOString()).toBe(stored?.readAt?.toISOString());

    const cleared = await post('notifications.markAllRead', {}, aliceUser.token);
    expect(cleared.status).toBe(200);
    expect(resultData(cleared.body)).toEqual({ count: 0 });
    const afterClear = await get('notifications.unreadCount', undefined, aliceUser.token);
    expect(resultData(afterClear.body).count).toBe(0);
    expect(await prisma.notification.count({ where: { userId: aliceUser.id, readAt: null } })).toBe(
      0,
    );
    expect(
      await prisma.notification.count({ where: { userId: caraUser.id, readAt: null } }),
    ).toBeGreaterThan(0);
  });

  it('opens the page around a reply and clears href after that reply is deleted', async () => {
    const aliceIdentity = nextIdentity('ntarounda');
    const bobIdentity = nextIdentity('ntaroundb');
    const alice = await register(aliceIdentity);
    const bob = await register(bobIdentity);
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const seriesSlug = `around-series-${suffix}`.slice(0, 64);
    const cardSlug = `around-card-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({ data: { slug: seriesSlug, title: '深链系列' } });
    await prisma.card.create({ data: { slug: cardSlug, name: '深链卡', seriesId: series.id } });
    const topic = await post(
      'forum.topics.create',
      { title: '深链话题', body: '没有提及' },
      alice.token,
    );
    expect(topic.status).toBe(200);
    const topicId = expectString(resultData(topic.body).id);

    const replyIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await post(
        'forum.replies.create',
        { topicId, body: `回帖 ${index}` },
        bob.token,
      );
      expect(created.status).toBe(200);
      const id = expectString(resultData(created.body).id);
      replyIds.push(id);
      await prisma.reply.update({
        where: { id },
        data: { createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)) },
      });
    }
    const forumPage = await get(
      'forum.replies.list',
      { topicId, limit: 2, aroundId: replyIds[4] },
      alice.token,
    );
    expect(forumPage.status).toBe(200);
    const forumItems = rowsOf(resultData(forumPage.body).items);
    expect(forumItems.map((item) => item.id)).toEqual([replyIds[4]]);
    expect(resultData(forumPage.body).nextCursor).toBeNull();

    const forumMiddle = await get(
      'forum.replies.list',
      { topicId, limit: 2, aroundId: replyIds[2] },
      alice.token,
    );
    expect(rowsOf(resultData(forumMiddle.body).items).map((item) => item.id)).toEqual([
      replyIds[2],
      replyIds[3],
    ]);
    const missingForum = await get(
      'forum.replies.list',
      { topicId, limit: 2, aroundId: '99999999-9999-4999-8999-999999999999' },
      alice.token,
    );
    expect(resultData(missingForum.body).items).toEqual([]);

    const parent = await post('comments.create', { cardSlug, content: '顶层评论' }, alice.token);
    expect(parent.status).toBe(200);
    const parentId = expectString(resultData(parent.body).id);
    const commentIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const created = await post(
        'comments.create',
        { cardSlug, content: `楼中楼 ${index}`, parentId },
        bob.token,
      );
      expect(created.status).toBe(200);
      const id = expectString(resultData(created.body).id);
      commentIds.push(id);
      await prisma.comment.update({
        where: { id },
        data: { createdAt: new Date(Date.UTC(2026, 10, 2, 0, 0, index)) },
      });
    }
    const commentPage = await get(
      'comments.listReplies',
      { parentId, limit: 2, aroundId: commentIds[4] },
      alice.token,
    );
    expect(commentPage.status).toBe(200);
    expect(rowsOf(resultData(commentPage.body).items).map((item) => item.id)).toEqual([
      commentIds[4],
    ]);

    const mention = await post(
      'comments.create',
      { cardSlug, content: `@${aliceIdentity.username} 看这里` },
      bob.token,
    );
    expect(mention.status).toBe(200);
    const mentionId = expectString(resultData(mention.body).id);
    const beforeDelete = await list(alice.token);
    const visible = beforeDelete.find(
      (item) => item.href === `/cards/${cardSlug}#comment-${mentionId}`,
    );
    expect(visible?.excerpt).toBe(`@${aliceIdentity.username} 看这里`);
    const removed = await post('comments.delete', { id: mentionId }, bob.token);
    expect(removed.status).toBe(200);
    const afterDelete = await list(alice.token);
    const hidden = afterDelete.find((item) => item.id === visible?.id);
    expect(hidden?.href).toBeNull();
    expect(hidden?.excerpt).toBe(`@${aliceIdentity.username} 看这里`);
    const bobView = await list(bob.token);
    expect(bobView.some((item) => item.id === hidden?.id)).toBe(false);
  });

  it('pages with createdAt desc, id desc and ignores another user', async () => {
    const owner = await register(nextIdentity('ntpage'));
    const other = await register(nextIdentity('ntother'));
    const pageIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    await prisma.notification.deleteMany({ where: { id: { in: pageIds } } });
    const createdAt = new Date('2026-11-01T00:00:00.000Z');
    await prisma.notification.createMany({
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          userId: owner.id,
          type: 'MENTION',
          targetType: 'TOPIC',
          targetId: '11111111-1111-4111-8111-111111111111',
          excerpt: 'first',
          createdAt,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          userId: owner.id,
          type: 'MENTION',
          targetType: 'TOPIC',
          targetId: '33333333-3333-4333-8333-333333333333',
          excerpt: 'third',
          createdAt,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          userId: owner.id,
          type: 'MENTION',
          targetType: 'TOPIC',
          targetId: '22222222-2222-4222-8222-222222222222',
          excerpt: 'second',
          createdAt,
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          userId: owner.id,
          type: 'MENTION',
          targetType: 'TOPIC',
          targetId: '44444444-4444-4444-8444-444444444444',
          excerpt: 'newer',
          createdAt: new Date('2026-11-01T00:00:01.000Z'),
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          userId: other.id,
          type: 'MENTION',
          targetType: 'TOPIC',
          targetId: '55555555-5555-4555-8555-555555555555',
          excerpt: 'secret-other-user',
          createdAt: new Date('2026-11-01T00:00:02.000Z'),
        },
      ],
    });

    const first = await get('notifications.list', { limit: 2 }, owner.token);
    expect(first.status).toBe(200);
    const firstData = resultData(first.body);
    const firstItems = rowsOf(firstData.items);
    expect(firstItems.map((item) => item.id)).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
    ]);
    for (const item of firstItems) {
      expect(item).not.toHaveProperty('parentId');
      expect(item).toEqual(
        expect.objectContaining({
          type: 'MENTION',
          actor: null,
          href: null,
          readAt: null,
        }),
      );
    }
    const cursor = expectString(firstData.nextCursor);
    expect(cursor.length).toBeLessThanOrEqual(36);
    const second = await get('notifications.list', { limit: 2, cursor }, owner.token);
    expect(rowsOf(resultData(second.body).items).map((item) => item.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(JSON.stringify(first.body)).not.toContain('secret-other-user');
    const garbage = await get('notifications.list', { cursor: 'not-a-real-cursor' }, owner.token);
    expect(garbage.status).toBe(200);
    expect(resultData(garbage.body).items).toEqual([]);
  });

  it('rejects anonymous callers, cross-user writes, bad input, and parser leaks', async () => {
    const alice = await register(nextIdentity('ntdeny'));
    const bob = await register(nextIdentity('ntpeek'));
    await prisma.notification.deleteMany({
      where: { id: '66666666-6666-4666-8666-666666666666' },
    });
    await prisma.notification.create({
      data: {
        id: '66666666-6666-4666-8666-666666666666',
        userId: alice.id,
        type: 'MENTION',
        targetType: 'TOPIC',
        targetId: '66666666-6666-4666-8666-666666666666',
        excerpt: 'ALICE_PRIVATE_EXCERPT',
      },
    });

    for (const path of ['notifications.list', 'notifications.unreadCount']) {
      const response = await get(path, path === 'notifications.list' ? { limit: 20 } : undefined);
      expect(response.status).toBe(401);
      expect(response.body.error.data.code).toBe('UNAUTHORIZED');
      expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
    }
    const anonRead = await post('notifications.markRead', {
      id: '66666666-6666-4666-8666-666666666666',
    });
    const anonAll = await post('notifications.markAllRead', {});
    expect(anonRead.status).toBe(401);
    expect(anonAll.status).toBe(401);

    const peeked = await get('notifications.list', { limit: 20 }, bob.token);
    expect(peeked.status).toBe(200);
    expect(JSON.stringify(peeked.body)).not.toContain('ALICE_PRIVATE_EXCERPT');
    expect(JSON.stringify(peeked.body)).not.toContain('66666666-6666-4666-8666-666666666666');

    const denied = await post(
      'notifications.markRead',
      { id: '66666666-6666-4666-8666-666666666666' },
      bob.token,
    );
    expect(denied.status).toBe(403);
    expect(denied.body.error.data.code).toBe('FORBIDDEN');
    expect(denied.body.error.data.appCode).toBe(APP_ERROR_CODES.FORBIDDEN);
    expect(JSON.stringify(denied.body)).not.toContain('ALICE_PRIVATE_EXCERPT');
    expect(
      (
        await prisma.notification.findUnique({
          where: { id: '66666666-6666-4666-8666-666666666666' },
        })
      )?.readAt,
    ).toBeNull();

    await post('notifications.markAllRead', {}, bob.token);
    expect(
      (
        await prisma.notification.findUnique({
          where: { id: '66666666-6666-4666-8666-666666666666' },
        })
      )?.readAt,
    ).toBeNull();

    const badLimit = await get('notifications.list', { limit: 51 }, alice.token);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.data.code).toBe('BAD_REQUEST');
    expect(badLimit.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);

    const badId = await post('notifications.markRead', { id: 'LEAK_MARKER' }, alice.token);
    expect(badId.status).toBe(400);
    expect(badId.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);

    const longCursor = await get('notifications.list', { cursor: 'x'.repeat(37) }, alice.token);
    expect(longCursor.status).toBe(400);
    expect(longCursor.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const badJson = await request(app.getHttpServer())
        .post('/trpc/notifications.markRead')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Forwarded-For', nextIp())
        .send('{"id":"LEAK_MARKER"');
      expect(badJson.status).toBe(400);
      expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
      expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
      expect(badJson.body.error.data.stack).toBeUndefined();
      const badText = JSON.stringify(badJson.body);
      expect(badText).not.toContain('LEAK_MARKER');
      expect(badText).not.toContain('is not valid JSON');
      expect(badText).not.toContain('Unexpected token');
      expect(badText).not.toContain('SyntaxError');
      expect(badText).not.toContain('Prisma');

      const tooLarge = await request(app.getHttpServer())
        .post('/trpc/notifications.markAllRead')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${alice.token}`)
        .set('X-Forwarded-For', nextIp())
        .send(Buffer.alloc(100 * 1024 + 1, 0x78));
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
      expect(tooLarge.body.error.data.httpStatus).toBe(413);
      expect(tooLarge.body.error.data.appCode).toBe(APP_ERROR_CODES.PAYLOAD_TOO_LARGE);
      expect(tooLarge.body.error.data.stack).toBeUndefined();
      const largeText = JSON.stringify(tooLarge.body);
      expect(largeText).not.toContain('entity.too.large');
      expect(largeText).not.toContain('Prisma');

      const boom = new Error('Invalid `prisma.notification.count()` invocation:\n\nLEAK_MARKER');
      boom.name = 'PrismaClientKnownRequestError';
      const countSpy = jest.spyOn(prisma.notification, 'count').mockRejectedValue(boom);
      try {
        const failed = await get('notifications.unreadCount', undefined, alice.token);
        expect(failed.status).toBeGreaterThanOrEqual(500);
        const failedText = JSON.stringify(failed.body);
        expect(failed.body.error.message).toBe(t('zh-CN', 'error.internal'));
        expect(failedText).not.toContain('LEAK_MARKER');
        expect(failedText).not.toMatch(/prisma/i);
        expect(failedText).not.toContain('invocation');
        expect(failedText).not.toContain('node_modules');
        expect(failed.body.error.data.stack).toBeUndefined();
      } finally {
        countSpy.mockRestore();
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('returns the saved comment and topic when the notification insert throws', async () => {
    const lines: string[] = [];
    const unsubscribe = subscribeLogLines((line) => {
      if (line.includes('notification_write_failed')) lines.push(line);
    });
    const alice = nextIdentity('failalice');
    const bob = nextIdentity('failbob');
    const admin = nextIdentity('failadmin');
    const aliceUser = await register(alice);
    const bobUser = await register(bob);
    const adminUser = await register(admin);
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'admin' } });

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const series = await prisma.series.create({
      data: { slug: `fail-series-${suffix}`.slice(0, 64), title: '失败系列' },
    });
    const cardSlug = `fail-card-${suffix}`.slice(0, 64);
    await prisma.card.create({ data: { slug: cardSlug, name: '失败卡', seriesId: series.id } });
    const plain = await post(
      'forum.topics.create',
      { title: '先发一条', body: '没有提及' },
      aliceUser.token,
    );
    expect(plain.status).toBe(200);
    const plainId = expectString(resultData(plain.body).id);

    const commentContent = `通知失败 @${bob.username}`;
    const topicBody = `话题通知失败 @${bob.username}`;
    const replyBody = '回复通知失败';
    const editedBody = `编辑后 @${bob.username}`;
    const boom = new Error('NOTIFY_WRITE_DOWN');
    const createMany = jest.spyOn(prisma.notification, 'createMany').mockRejectedValue(boom);
    try {
      const comment = await post(
        'comments.create',
        { cardSlug, content: commentContent },
        aliceUser.token,
      );
      expect(comment.status).toBe(200);
      const commentId = expectString(resultData(comment.body).id);
      expect(JSON.stringify(comment.body)).not.toContain('NOTIFY_WRITE_DOWN');
      expect(
        await prisma.comment.count({ where: { userId: aliceUser.id, content: commentContent } }),
      ).toBe(1);
      expect(await prisma.notification.count({ where: { targetId: commentId } })).toBe(0);

      const topic = await post(
        'forum.topics.create',
        { title: '通知失败话题', body: topicBody },
        aliceUser.token,
      );
      expect(topic.status).toBe(200);
      const topicId = expectString(resultData(topic.body).id);
      expect(JSON.stringify(topic.body)).not.toContain('NOTIFY_WRITE_DOWN');
      expect(await prisma.topic.count({ where: { userId: aliceUser.id, body: topicBody } })).toBe(
        1,
      );
      expect(await prisma.notification.count({ where: { targetId: topicId } })).toBe(0);

      const reply = await post(
        'forum.replies.create',
        { topicId: plainId, body: replyBody },
        bobUser.token,
      );
      expect(reply.status).toBe(200);
      const replyId = expectString(resultData(reply.body).id);
      expect(JSON.stringify(reply.body)).not.toContain('NOTIFY_WRITE_DOWN');
      expect(await prisma.reply.count({ where: { id: replyId, body: replyBody } })).toBe(1);
      expect(await prisma.notification.count({ where: { targetId: replyId } })).toBe(0);

      const edited = await post(
        'forum.topics.update',
        { id: plainId, title: '先发一条', body: editedBody },
        aliceUser.token,
      );
      expect(edited.status).toBe(200);
      expect(JSON.stringify(edited.body)).not.toContain('NOTIFY_WRITE_DOWN');
      expect(await prisma.topic.count({ where: { id: plainId, body: editedBody } })).toBe(1);

      const report = await post(
        'reports.create',
        { targetType: 'COMMENT', targetId: commentId, reason: '通知失败时仍要处理' },
        bobUser.token,
      );
      expect(report.status).toBe(200);
      const resolved = await post(
        'reports.resolve',
        {
          id: expectString(resultData(report.body).id),
          action: 'MARK_RESOLVED',
          resolution: 'SECRET',
        },
        adminUser.token,
      );
      expect(resolved.status).toBe(200);
      expect(resultData(resolved.body)).toEqual({ ok: true });
      expect(JSON.stringify(resolved.body)).not.toContain('NOTIFY_WRITE_DOWN');
      expect(JSON.stringify(resolved.body)).not.toContain('SECRET');
      expect(
        await prisma.report.count({
          where: { id: expectString(resultData(report.body).id), status: 'RESOLVED' },
        }),
      ).toBe(1);
      expect(await prisma.comment.count({ where: { id: commentId } })).toBe(1);
      expect(await prisma.notification.count({ where: { targetId: commentId } })).toBe(0);
    } finally {
      createMany.mockRestore();
      unsubscribe();
    }

    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed) || !isRecord(parsed.message)) {
        throw new Error('expected a structured notification failure log');
      }
      expect(parsed.level).toBe('error');
      expect(parsed.context).toBe('Notifications');
      expect(parsed.message.event).toBe('notification_write_failed');
      expect(parsed.message.code).toBe('unknown');
      expect(line).not.toContain('NOTIFY_WRITE_DOWN');
    }
  });
});
