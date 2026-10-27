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

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error('expected a list');
  return value as Array<Record<string, unknown>>;
}

describe('comment replies', () => {
  let app: INestApplication;
  let limited: INestApplication;
  let prisma: PrismaService;
  let aliceToken = '';
  let bobToken = '';
  let adminToken = '';
  let aliceName = '';
  let bobName = '';
  let cardSlug = '';
  let otherCardSlug = '';
  let seriesSlug = '';

  beforeAll(async () => {
    app = await createApp();
    limited = await createApp({
      rateLimitOverrides: { commentCreate: { limit: 1, windowMs: 60_000 } },
    });
    await app.init();
    await limited.init();
    prisma = app.get(PrismaService);

    const alice = nextIdentity('repalice');
    const bob = nextIdentity('repbob');
    const admin = nextIdentity('repadm');
    aliceName = alice.username;
    bobName = bob.username;
    aliceToken = (await register(alice)).token;
    bobToken = (await register(bob)).token;
    const adminUser = await register(admin);
    adminToken = adminUser.token;
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'admin' } });

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    seriesSlug = `reply-series-${suffix}`.slice(0, 64);
    cardSlug = `reply-card-${suffix}`.slice(0, 64);
    otherCardSlug = `reply-other-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: '回复系列' },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: '回复卡', seriesId: series.id },
    });
    await prisma.card.create({
      data: { slug: otherCardSlug, name: '另一张', seriesId: series.id },
    });
  });

  afterAll(async () => {
    await app?.close();
    await limited?.close();
  });

  function post(path: string, body: unknown, token?: string, ip = '203.0.113.80') {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function get(path: string, input: unknown) {
    return request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.81');
  }

  async function register(identity: ReturnType<typeof nextIdentity>) {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({
        email: identity.email,
        username: identity.username,
        password: 'reply-password',
      });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (typeof user !== 'object' || user === null || !('id' in user)) {
      throw new Error('expected a user');
    }
    return { token: expectString(data.token), id: expectString(user.id) };
  }

  async function createComment(
    path: 'comments.create' | 'comments.createForSeries',
    body: Record<string, unknown>,
    token: string,
    ip: string,
  ) {
    const response = await post(path, body, token, ip);
    expect(response.status).toBe(200);
    return expectString(resultData(response.body).id);
  }

  function expectParentGone(response: request.Response) {
    expect(response.status).toBe(404);
    expect(response.body.error.data.code).toBe('NOT_FOUND');
    expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.COMMENT_PARENT_GONE);
  }

  it('lists newest top-level comments with oldest replies and rejects blank or misplaced parents', async () => {
    const older = await createComment(
      'comments.create',
      { cardSlug, content: 'older top' },
      aliceToken,
      '203.0.113.90',
    );
    const first = await createComment(
      'comments.create',
      { cardSlug, content: `@${aliceName} first`, parentId: older },
      bobToken,
      '203.0.113.91',
    );
    const second = await createComment(
      'comments.create',
      { cardSlug, content: 'second reply', parentId: older },
      aliceToken,
      '203.0.113.92',
    );
    const third = await createComment(
      'comments.create',
      { cardSlug, content: 'third reply', parentId: older },
      bobToken,
      '203.0.113.93',
    );
    const fourth = await createComment(
      'comments.create',
      { cardSlug, content: 'fourth reply', parentId: older },
      aliceToken,
      '203.0.113.94',
    );
    const newer = await createComment(
      'comments.create',
      { cardSlug, content: 'newer top' },
      bobToken,
      '203.0.113.95',
    );

    const listed = await get('comments.listForCard', { cardSlug });
    expect(listed.status).toBe(200);
    const rows = asRows(listed.body.result?.data);
    expect(rows.map((row) => row.id)).toEqual([newer, older]);
    const thread = rows[1];
    const replies = asRows(thread?.replies);
    expect(thread?.replyCount).toBe(4);
    expect(replies.map((reply) => reply.id)).toEqual([first, second, third]);
    expect(thread?.repliesNextCursor).toBe(third);
    expect(rows[0]?.replyCount).toBe(0);
    expect(rows[0]?.replies).toEqual([]);
    expect(rows[0]?.repliesNextCursor).toBeNull();

    const page = await get('comments.listReplies', { parentId: older, cursor: third, limit: 20 });
    expect(page.status).toBe(200);
    const replyPage = resultData(page.body);
    expect(asRows(replyPage.items).map((reply) => reply.id)).toEqual([fourth]);
    expect(replyPage.nextCursor).toBeNull();

    const mentionOnly = await post(
      'comments.create',
      { cardSlug, content: `  @${bobName}  `, parentId: older },
      aliceToken,
      '203.0.113.96',
    );
    expect(mentionOnly.status).toBe(400);
    expect(mentionOnly.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);

    const blank = await post(
      'comments.create',
      { cardSlug, content: '   ', parentId: older },
      aliceToken,
      '203.0.113.97',
    );
    expect(blank.status).toBe(400);
    expect(blank.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);

    const nested = await post(
      'comments.create',
      { cardSlug, content: 'not nested', parentId: first },
      aliceToken,
      '203.0.113.98',
    );
    expectParentGone(nested);

    const missing = await post(
      'comments.create',
      {
        cardSlug,
        content: 'gone',
        parentId: '99999999-9999-4999-8999-999999999999',
      },
      aliceToken,
      '203.0.113.99',
    );
    expectParentGone(missing);

    const otherTop = await createComment(
      'comments.create',
      { cardSlug: otherCardSlug, content: 'other card' },
      aliceToken,
      '203.0.113.100',
    );
    const wrongCard = await post(
      'comments.create',
      { cardSlug, content: 'wrong card', parentId: otherTop },
      aliceToken,
      '203.0.113.101',
    );
    expectParentGone(wrongCard);

    const seriesTop = await createComment(
      'comments.createForSeries',
      { seriesSlug, content: 'series top' },
      aliceToken,
      '203.0.113.102',
    );
    const seriesReply = await createComment(
      'comments.createForSeries',
      { seriesSlug, content: 'series reply', parentId: seriesTop },
      bobToken,
      '203.0.113.103',
    );
    const seriesList = await get('comments.listForSeries', { seriesSlug });
    expect(seriesList.status).toBe(200);
    const seriesRows = asRows(seriesList.body.result?.data);
    expect(seriesRows[0]?.id).toBe(seriesTop);
    expect(asRows(seriesRows[0]?.replies).map((reply) => reply.id)).toEqual([seriesReply]);

    const wrongSeries = await post(
      'comments.createForSeries',
      { seriesSlug, content: 'not this series', parentId: older },
      aliceToken,
      '203.0.113.104',
    );
    expectParentGone(wrongSeries);
  });

  it('writes one audit row when an admin deletes a thread and drops the replies', async () => {
    const top = await createComment(
      'comments.create',
      { cardSlug, content: 'delete me' },
      aliceToken,
      '203.0.113.110',
    );
    const reply = await createComment(
      'comments.create',
      { cardSlug, content: 'goes with it', parentId: top },
      bobToken,
      '203.0.113.111',
    );
    const removed = await post(
      'comments.delete',
      { id: top, reason: '  thread spam  ' },
      adminToken,
      '203.0.113.112',
    );
    expect(removed.status).toBe(200);
    expect(await prisma.comment.findUnique({ where: { id: top } })).toBeNull();
    expect(await prisma.comment.findUnique({ where: { id: reply } })).toBeNull();
    const audits = await prisma.auditLog.findMany({
      where: { action: 'CONTENT_DELETE', targetId: { in: [top, reply] } },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ targetId: top, reason: 'thread spam' });
  });

  function expectNoLeak(body: unknown) {
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('LEAK_MARKER');
    expect(serialized).not.toContain('Prisma');
    expect(serialized).not.toContain('prisma.');
    expect(serialized).not.toContain('node_modules');
    expect(serialized).not.toMatch(/at Object\./);
  }

  it('rejects an oversize body with 413 and a too-long reply with 400 without leaking internals', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const badJson = await request(app.getHttpServer())
        .post('/trpc/comments.create')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Forwarded-For', '203.0.113.130')
        .send('{"content":"LEAK_MARKER"');
      expect(badJson.status).toBe(400);
      expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
      expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
      expect(badJson.body.error.data.stack).toBeUndefined();
      expectNoLeak(badJson.body);

      const tooLarge = await request(app.getHttpServer())
        .post('/trpc/comments.create')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Forwarded-For', '203.0.113.131')
        .send(Buffer.alloc(100 * 1024 + 1, 0x78));
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
      expect(tooLarge.body.error.data.httpStatus).toBe(413);
      expect(tooLarge.body.error.data.stack).toBeUndefined();
      expectNoLeak(tooLarge.body);

      const top = await createComment(
        'comments.create',
        { cardSlug, content: 'length parent' },
        aliceToken,
        '203.0.113.132',
      );
      const tooLong = await post(
        'comments.create',
        { cardSlug, content: `${'字'.repeat(501)}`, parentId: top },
        bobToken,
        '203.0.113.133',
      );
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.data.code).toBe('BAD_REQUEST');
      expect(tooLong.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(tooLong.body.error.data.stack).toBeUndefined();
      expect(tooLong.body.error.message).not.toContain('字'.repeat(40));
      expectNoLeak(tooLong.body);
      expect(
        await prisma.comment.count({ where: { parentId: top } }),
      ).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('shares the comment create limiter with replies', async () => {
    const top = await createComment(
      'comments.create',
      { cardSlug, content: 'rate parent' },
      aliceToken,
      '203.0.113.120',
    );
    const first = await request(limited.getHttpServer())
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${bobToken}`)
      .set('X-Forwarded-For', '203.0.113.121')
      .send({ cardSlug, content: 'within limit', parentId: top });
    expect(first.status).toBe(200);
    const second = await request(limited.getHttpServer())
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${bobToken}`)
      .set('X-Forwarded-For', '203.0.113.121')
      .send({ cardSlug, content: 'over limit', parentId: top });
    expect(second.status).toBe(429);
    expect(second.body.error.data.appCode).toBe(APP_ERROR_CODES.TOO_MANY_REQUESTS);
  });
});
