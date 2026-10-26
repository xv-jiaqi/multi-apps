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

function expectString(value: unknown): string {
  expect(typeof value).toBe('string');
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
}

function resultData(body: { result?: { data?: unknown } }): Record<string, unknown> {
  const data = body.result?.data;
  if (typeof data !== 'object' || data === null) throw new Error('expected a result object');
  return data;
}

describe('content delete reason', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken = '';
  let adminToken = '';
  let ownerId = '';
  let cardSlug = '';
  let seriesSlug = '';

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const owner = nextIdentity('own');
    const admin = nextIdentity('adm');
    ownerToken = (await register(owner)).token;
    ownerId = (
      await prisma.user.findUniqueOrThrow({
        where: { username: owner.username },
        select: { id: true },
      })
    ).id;
    const adminUser = await register(admin);
    adminToken = adminUser.token;
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'admin' } });

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    seriesSlug = `cd-series-${suffix}`.slice(0, 64);
    cardSlug = `cd-card-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: '删除原因系列' },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: '删除原因卡', seriesId: series.id },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, body: unknown, token: string, ip: string) {
    return request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', ip)
      .send(body);
  }

  async function register(identity: ReturnType<typeof nextIdentity>) {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({
        email: identity.email,
        username: identity.username,
        password: 'reason-password',
      });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (typeof user !== 'object' || user === null || !('id' in user)) {
      throw new Error('expected a user');
    }
    return { token: expectString(data.token), id: expectString(user.id) };
  }

  async function auditsFor(targetId: string) {
    return prisma.auditLog.findMany({ where: { targetId, action: 'CONTENT_DELETE' } });
  }

  function expectNoLeak(body: unknown) {
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('LEAK_MARKER');
    expect(serialized).not.toContain('Prisma');
    expect(serialized).not.toContain('prisma.');
    expect(serialized).not.toContain('node_modules');
    expect(serialized).not.toMatch(/at Object\./);
  }

  async function expectTooLong(path: string, body: Record<string, unknown>, token: string) {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await post(
        path,
        { ...body, reason: `LEAK_MARKER${'x'.repeat(490)}` },
        token,
        '203.0.113.20',
      );
      expect(response.status).toBe(400);
      expect(response.body.error.data.code).toBe('BAD_REQUEST');
      expect(response.body.error.data.httpStatus).toBe(400);
      expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(response.body.error.data.stack).toBeUndefined();
      expectNoLeak(response.body);
      return response;
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  }

  it('writes a comment reason in the same transaction and ignores self-delete reasons', async () => {
    const created = await post(
      'comments.create',
      { cardSlug, content: 'admin will remove this' },
      ownerToken,
      '203.0.113.21',
    );
    expect(created.status).toBe(200);
    const commentId = expectString(resultData(created.body).id);

    const withReason = await post(
      'comments.delete',
      { id: commentId, reason: '  spam link  ' },
      adminToken,
      '203.0.113.22',
    );
    expect(withReason.status).toBe(200);
    expect(resultData(withReason.body)).toEqual({ ok: true });
    const written = await auditsFor(commentId);
    expect(written).toHaveLength(1);
    expect(written[0]?.reason).toBe('spam link');
    expect(written[0]?.targetType).toBe('COMMENT');
    expect(written[0]?.targetUserId).toBe(ownerId);
    expect(await prisma.comment.findUnique({ where: { id: commentId } })).toBeNull();

    const blank = await post(
      'comments.create',
      { cardSlug, content: 'no reason given' },
      ownerToken,
      '203.0.113.23',
    );
    const blankId = expectString(resultData(blank.body).id);
    const withoutReason = await post(
      'comments.delete',
      { id: blankId },
      adminToken,
      '203.0.113.24',
    );
    expect(withoutReason.status).toBe(200);
    expect(resultData(withoutReason.body)).toEqual({ ok: true });
    const empty = await auditsFor(blankId);
    expect(empty).toHaveLength(1);
    expect(empty[0]?.reason).toBeNull();

    const own = await post(
      'comments.create',
      { cardSlug, content: 'owner removes this' },
      ownerToken,
      '203.0.113.25',
    );
    const ownId = expectString(resultData(own.body).id);
    const ignored = await post(
      'comments.delete',
      { id: ownId, reason: 'should be ignored' },
      ownerToken,
      '203.0.113.26',
    );
    expect(ignored.status).toBe(200);
    expect(resultData(ignored.body)).toEqual({ ok: true });
    expect(await auditsFor(ownId)).toHaveLength(0);

    const kept = await post(
      'comments.create',
      { cardSlug, content: 'still here' },
      ownerToken,
      '203.0.113.27',
    );
    const keptId = expectString(resultData(kept.body).id);
    await expectTooLong('comments.delete', { id: keptId }, adminToken);
    expect(await prisma.comment.findUnique({ where: { id: keptId } })).not.toBeNull();
    expect(await auditsFor(keptId)).toHaveLength(0);
  });

  it('records topic and reply reasons only when an admin deletes someone else', async () => {
    const topic = await post(
      'forum.topics.create',
      { title: 'Reason topic', body: 'Body for the reason test.' },
      ownerToken,
      '203.0.113.28',
    );
    expect(topic.status).toBe(200);
    const topicId = expectString(resultData(topic.body).id);
    const reply = await post(
      'forum.replies.create',
      { topicId, body: 'A reply to remove.' },
      ownerToken,
      '203.0.113.29',
    );
    const replyId = expectString(resultData(reply.body).id);

    const removedReply = await post(
      'forum.replies.delete',
      { id: replyId, reason: 'off topic' },
      adminToken,
      '203.0.113.30',
    );
    expect(removedReply.status).toBe(200);
    expect(resultData(removedReply.body)).toEqual({ ok: true });
    expect((await auditsFor(replyId))[0]?.reason).toBe('off topic');
    expect((await auditsFor(replyId))[0]?.targetType).toBe('REPLY');

    const plainReply = await post(
      'forum.replies.create',
      { topicId, body: 'Reply without a reason.' },
      ownerToken,
      '203.0.113.31',
    );
    const plainReplyId = expectString(resultData(plainReply.body).id);
    const noReason = await post(
      'forum.replies.delete',
      { id: plainReplyId },
      adminToken,
      '203.0.113.32',
    );
    expect(noReason.status).toBe(200);
    expect((await auditsFor(plainReplyId))[0]?.reason).toBeNull();

    const ownReply = await post(
      'forum.replies.create',
      { topicId, body: 'Owner reply.' },
      ownerToken,
      '203.0.113.33',
    );
    const ownReplyId = expectString(resultData(ownReply.body).id);
    const selfReply = await post(
      'forum.replies.delete',
      { id: ownReplyId, reason: 'ignored' },
      ownerToken,
      '203.0.113.34',
    );
    expect(selfReply.status).toBe(200);
    expect(await auditsFor(ownReplyId)).toHaveLength(0);

    const keptReply = await post(
      'forum.replies.create',
      { topicId, body: 'Keep this reply.' },
      ownerToken,
      '203.0.113.35',
    );
    const keptReplyId = expectString(resultData(keptReply.body).id);
    await expectTooLong('forum.replies.delete', { id: keptReplyId }, adminToken);
    expect(await prisma.reply.findUnique({ where: { id: keptReplyId } })).not.toBeNull();

    const removedTopic = await post(
      'forum.topics.delete',
      { id: topicId, reason: '  duplicate  ' },
      adminToken,
      '203.0.113.36',
    );
    expect(removedTopic.status).toBe(200);
    expect(resultData(removedTopic.body)).toEqual({ ok: true });
    expect((await auditsFor(topicId))[0]?.reason).toBe('duplicate');
    expect((await auditsFor(topicId))[0]?.targetType).toBe('TOPIC');

    const other = await post(
      'forum.topics.create',
      { title: 'No reason topic', body: 'Deleted with an empty reason.' },
      ownerToken,
      '203.0.113.37',
    );
    const otherId = expectString(resultData(other.body).id);
    const bare = await post('forum.topics.delete', { id: otherId }, adminToken, '203.0.113.38');
    expect(bare.status).toBe(200);
    expect((await auditsFor(otherId))[0]?.reason).toBeNull();

    const ownTopic = await post(
      'forum.topics.create',
      { title: 'Own topic', body: 'The author deletes this.' },
      ownerToken,
      '203.0.113.39',
    );
    const ownTopicId = expectString(resultData(ownTopic.body).id);
    const selfTopic = await post(
      'forum.topics.delete',
      { id: ownTopicId, reason: 'ignored' },
      ownerToken,
      '203.0.113.40',
    );
    expect(selfTopic.status).toBe(200);
    expect(await auditsFor(ownTopicId)).toHaveLength(0);

    const keptTopic = await post(
      'forum.topics.create',
      { title: 'Kept topic', body: 'Too long a reason must not delete this.' },
      ownerToken,
      '203.0.113.41',
    );
    const keptTopicId = expectString(resultData(keptTopic.body).id);
    await expectTooLong('forum.topics.delete', { id: keptTopicId }, adminToken);
    expect(await prisma.topic.findUnique({ where: { id: keptTopicId } })).not.toBeNull();
  });

  it('records a listing close reason only for an admin closing someone else', async () => {
    const published = await post(
      'listings.publish',
      { cardSlug, kind: 'SELL', contact: 'wechat: reason', currency: 'CNY' },
      ownerToken,
      '203.0.113.42',
    );
    expect(published.status).toBe(200);
    const listingId = expectString(resultData(published.body).id);
    const closed = await post(
      'listings.close',
      { id: listingId, reason: '  already sold  ' },
      adminToken,
      '203.0.113.43',
    );
    expect(closed.status).toBe(200);
    expect(resultData(closed.body)).toEqual({ ok: true });
    const audit = await auditsFor(listingId);
    expect(audit[0]?.reason).toBe('already sold');
    expect(audit[0]?.targetType).toBe('LISTING');
    expect(audit[0]?.targetLabel).toBe(cardSlug);

    const second = await post(
      'listings.publish',
      { cardSlug, kind: 'BUY', contact: 'mail: reason', currency: 'CNY' },
      ownerToken,
      '203.0.113.44',
    );
    const secondId = expectString(resultData(second.body).id);
    const bare = await post('listings.close', { id: secondId }, adminToken, '203.0.113.45');
    expect(bare.status).toBe(200);
    expect((await auditsFor(secondId))[0]?.reason).toBeNull();

    const third = await post(
      'listings.publish',
      { cardSlug, kind: 'SELL', contact: 'own close', currency: 'CNY' },
      ownerToken,
      '203.0.113.46',
    );
    const thirdId = expectString(resultData(third.body).id);
    const self = await post(
      'listings.close',
      { id: thirdId, reason: 'ignored' },
      ownerToken,
      '203.0.113.47',
    );
    expect(self.status).toBe(200);
    expect(await auditsFor(thirdId)).toHaveLength(0);

    const fourth = await post(
      'listings.publish',
      { cardSlug, kind: 'SELL', contact: 'keep open', currency: 'CNY' },
      ownerToken,
      '203.0.113.48',
    );
    const fourthId = expectString(resultData(fourth.body).id);
    await expectTooLong('listings.close', { id: fourthId }, adminToken);
    const stillOpen = await prisma.listing.findUnique({ where: { id: fourthId } });
    expect(stillOpen?.status).toBe('OPEN');
    expect(await auditsFor(fourthId)).toHaveLength(0);
  });

  it('records card and series reasons and rejects a reason over 500 characters', async () => {
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const deleteSeries = `cd-del-${suffix}`.slice(0, 64);
    const deleteCard = `cd-card-del-${suffix}`.slice(0, 64);
    const keptSeries = `cd-kept-${suffix}`.slice(0, 64);
    const keptCard = `cd-kept-card-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({ data: { slug: deleteSeries, title: '待删系列' } });
    await prisma.card.create({ data: { slug: deleteCard, name: '待删卡', seriesId: series.id } });
    const kept = await prisma.series.create({ data: { slug: keptSeries, title: '保留系列' } });
    await prisma.card.create({ data: { slug: keptCard, name: '保留卡', seriesId: kept.id } });

    const cardGone = await post(
      'admin.cards.delete',
      { slug: deleteCard, reason: '  duplicate art  ' },
      adminToken,
      '203.0.113.49',
    );
    expect(cardGone.status).toBe(200);
    expect(resultData(cardGone.body)).toEqual({ ok: true, slug: deleteCard, commentCount: 0 });
    const cardAudit = await prisma.auditLog.findMany({
      where: { targetType: 'CARD', targetLabel: '待删卡' },
    });
    expect(cardAudit[0]?.reason).toBe('duplicate art');
    expect(cardAudit[0]?.targetUserId).toBeNull();

    const bareCardSlug = `cd-bare-${suffix}`.slice(0, 64);
    const bareCard = await prisma.card.create({
      data: { slug: bareCardSlug, name: '无原因卡', seriesId: kept.id },
    });
    const bare = await post(
      'admin.cards.delete',
      { slug: bareCardSlug },
      adminToken,
      '203.0.113.50',
    );
    expect(bare.status).toBe(200);
    expect(resultData(bare.body)).toEqual({ ok: true, slug: bareCardSlug, commentCount: 0 });
    expect((await auditsFor(bareCard.id))[0]?.reason).toBeNull();

    const forbidden = await post(
      'admin.cards.delete',
      { slug: keptCard, reason: 'not an admin' },
      ownerToken,
      '203.0.113.51',
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.data.code).toBe('FORBIDDEN');
    expect(await prisma.card.findUnique({ where: { slug: keptCard } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { targetLabel: '保留卡' } })).toBe(0);

    await expectTooLong('admin.cards.delete', { slug: keptCard }, adminToken);
    expect(await prisma.card.findUnique({ where: { slug: keptCard } })).not.toBeNull();

    const seriesGone = await post(
      'admin.series.delete',
      { slug: deleteSeries, force: false, reason: ' retired ' },
      adminToken,
      '203.0.113.52',
    );
    expect(seriesGone.status).toBe(200);
    expect(resultData(seriesGone.body)).toMatchObject({
      ok: true,
      slug: deleteSeries,
      cardCount: 0,
      commentCount: 0,
    });
    const seriesAudit = await auditsFor(series.id);
    expect(seriesAudit[0]?.reason).toBe('retired');
    expect(seriesAudit[0]?.targetType).toBe('SERIES');

    const bareSeriesSlug = `cd-bare-series-${suffix}`.slice(0, 64);
    const bareSeries = await prisma.series.create({
      data: { slug: bareSeriesSlug, title: '无原因系列' },
    });
    const bareSeriesDelete = await post(
      'admin.series.delete',
      { slug: bareSeriesSlug, force: false },
      adminToken,
      '203.0.113.53',
    );
    expect(bareSeriesDelete.status).toBe(200);
    expect((await auditsFor(bareSeries.id))[0]?.reason).toBeNull();

    const seriesForbidden = await post(
      'admin.series.delete',
      { slug: keptSeries, force: false, reason: 'ignored' },
      ownerToken,
      '203.0.113.54',
    );
    expect(seriesForbidden.status).toBe(403);
    expect(await prisma.series.findUnique({ where: { slug: keptSeries } })).not.toBeNull();
    expect(await auditsFor(kept.id)).toHaveLength(0);

    await expectTooLong('admin.series.delete', { slug: keptSeries, force: false }, adminToken);
    expect(await prisma.series.findUnique({ where: { slug: keptSeries } })).not.toBeNull();
    expect(await auditsFor(kept.id)).toHaveLength(0);
  });
});
