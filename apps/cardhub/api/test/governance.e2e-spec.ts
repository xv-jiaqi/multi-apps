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

function expectNoLeak(body: unknown) {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('LEAK_MARKER');
  expect(serialized).not.toContain('Prisma');
  expect(serialized).not.toContain('prisma.');
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toMatch(/at Object\./);
  expect(serialized).not.toContain('Invocation');
}

describe('user governance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken = '';
  let adminId = '';
  let adminUsername = '';
  let otherAdminId = '';
  let userToken = '';
  let userId = '';
  let userUsername = '';
  let cardSlug = '';
  let seriesSlug = '';
  let topicId = '';
  let commentId = '';

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const admin = nextIdentity('govadm');
    const otherAdmin = nextIdentity('govadm2');
    const user = nextIdentity('govusr');
    const adminUser = await register(admin);
    const other = await register(otherAdmin);
    const member = await register(user);
    adminToken = adminUser.token;
    adminId = adminUser.id;
    adminUsername = admin.username;
    otherAdminId = other.id;
    userToken = member.token;
    userId = member.id;
    userUsername = user.username;
    await prisma.user.update({ where: { id: adminId }, data: { role: 'admin' } });
    await prisma.user.update({ where: { id: otherAdminId }, data: { role: 'admin' } });

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    seriesSlug = `gov-series-${suffix}`.slice(0, 64);
    cardSlug = `gov-card-${suffix}`.slice(0, 64);
    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: '治理系列' },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: '治理卡', seriesId: series.id },
    });

    const topic = await post(
      'forum.topics.create',
      { title: '治理话题', body: '正文' },
      userToken,
      '203.0.113.40',
    );
    expect(topic.status).toBe(200);
    topicId = expectString(resultData(topic.body).id);

    const comment = await post(
      'comments.create',
      { cardSlug, content: '治理评论' },
      userToken,
      '203.0.113.41',
    );
    expect(comment.status).toBe(200);
    commentId = expectString(resultData(comment.body).id);

    const reply = await post(
      'forum.replies.create',
      { topicId, body: '治理回帖' },
      userToken,
      '203.0.113.42',
    );
    expect(reply.status).toBe(200);

    const seriesComment = await post(
      'comments.createForSeries',
      { seriesSlug, content: '系列评论' },
      userToken,
      '203.0.113.43',
    );
    expect(seriesComment.status).toBe(200);

    const listing = await post(
      'listings.publish',
      { cardSlug, kind: 'SELL', contact: 'wx-gov', note: '一张' },
      userToken,
      '203.0.113.44',
    );
    expect(listing.status).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, body: unknown, token?: string, ip = '203.0.113.50') {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function get(path: string, input: unknown, token?: string) {
    const req = request(app.getHttpServer())
      .get(`/trpc/${path}`)
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.51');
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
        password: 'governance-password',
      });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (typeof user !== 'object' || user === null || !('id' in user)) {
      throw new Error('expected a user');
    }
    return { token: expectString(data.token), id: expectString(user.id) };
  }

  async function login(username: string, ip: string) {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.login')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip)
      .send({ identifier: username, password: 'governance-password' });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (typeof user !== 'object' || user === null) throw new Error('expected a user');
    return { token: expectString(data.token), user: user as Record<string, unknown> };
  }

  async function expectAdminDenied(path: string, body: unknown, method: 'get' | 'post' = 'post') {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const anonymous =
        method === 'get'
          ? await get(path, body)
          : await post(path, body, undefined, '203.0.113.60');
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.data.appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
      expect(anonymous.body.error.data.stack).toBeUndefined();
      expectNoLeak(anonymous.body);

      const member =
        method === 'get'
          ? await get(path, body, userToken)
          : await post(path, body, userToken, '203.0.113.61');
      expect(member.status).toBe(403);
      expect(member.body.error.data.code).toBe('FORBIDDEN');
      expect(member.body.error.data.appCode).toBe(APP_ERROR_CODES.FORBIDDEN);
      expect(member.body.error.data.stack).toBeUndefined();
      expectNoLeak(member.body);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  }

  it('rejects anonymous and non-admin callers on every new admin procedure', async () => {
    await expectAdminDenied('admin.users.list', { limit: 20 }, 'get');
    await expectAdminDenied('admin.users.ban', { userId, reason: 'spam' });
    await expectAdminDenied('admin.users.unban', { userId, reason: 'appeal' });
    await expectAdminDenied('admin.audit.list', { limit: 50 }, 'get');
  });

  it('rejects an oversize body with 413 and bad JSON with 400 without leaking parser text', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const badJson = await request(app.getHttpServer())
        .post('/trpc/admin.users.ban')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${adminToken}`)
        .send('{"reason":"LEAK_MARKER"');
      expect(badJson.status).toBe(400);
      expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
      expect(badJson.body.error.data.stack).toBeUndefined();
      expectNoLeak(badJson.body);

      const tooLarge = await request(app.getHttpServer())
        .post('/trpc/admin.users.ban')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(Buffer.alloc(100 * 1024 + 1, 0x78));
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
      expect(tooLarge.body.error.data.httpStatus).toBe(413);
      expect(tooLarge.body.error.data.stack).toBeUndefined();
      expectNoLeak(tooLarge.body);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('rejects a reason over 500 characters and a blank reason with VALIDATION', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const tooLong = await post(
        'admin.users.ban',
        { userId, reason: `LEAK_MARKER${'字'.repeat(500)}` },
        adminToken,
        '203.0.113.62',
      );
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(tooLong.body.error.data.stack).toBeUndefined();
      expectNoLeak(tooLong.body);

      const blank = await post(
        'admin.users.ban',
        { userId, reason: '   ' },
        adminToken,
        '203.0.113.63',
      );
      expect(blank.status).toBe(400);
      expect(blank.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expectNoLeak(blank.body);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('refuses to ban yourself or another admin', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const self = await post(
        'admin.users.ban',
        { userId: adminId, reason: '自己' },
        adminToken,
        '203.0.113.64',
      );
      expect(self.status).toBe(403);
      expect(self.body.error.data.appCode).toBe(APP_ERROR_CODES.CANNOT_BAN_SELF);
      expect(self.body.error.data.stack).toBeUndefined();
      expectNoLeak(self.body);

      const adminTarget = await post(
        'admin.users.ban',
        { userId: otherAdminId, reason: '管理员' },
        adminToken,
        '203.0.113.65',
      );
      expect(adminTarget.status).toBe(403);
      expect(adminTarget.body.error.data.appCode).toBe(APP_ERROR_CODES.CANNOT_BAN_ADMIN);
      expect(adminTarget.body.error.message).toBe('不能封禁管理员');
      expect(adminTarget.body.error.data.stack).toBeUndefined();
      expectNoLeak(adminTarget.body);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('bans with one indexed user read, invalidates the old token, and blocks writes', async () => {
    const listed = await get('admin.users.list', { q: userUsername, limit: 20 }, adminToken);
    expect(listed.status).toBe(200);
    const page = resultData(listed.body);
    const items = page.items as Array<Record<string, unknown>>;
    expect(page.total).toBe(1);
    expect(items).toHaveLength(1);
    const counts = items[0]?.counts as Record<string, number>;
    expect(counts).toEqual({ topics: 1, replies: 1, comments: 2, listings: 1 });
    expect(items[0]?.bannedAt).toBeNull();

    const versionBefore = (
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tokenVersion: true },
      })
    ).tokenVersion;

    const banned = await post(
      'admin.users.ban',
      { userId, reason: '  多次骚扰  ' },
      adminToken,
      '203.0.113.66',
    );
    expect(banned.status).toBe(200);
    const row = resultData(banned.body);
    expect(row.bannedAt).toEqual(expect.any(String));
    expect(row.bannedBy).toEqual({ username: adminUsername });
    expect(row).not.toHaveProperty('password');

    const versionAfter = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenVersion: true, bannedById: true },
    });
    expect(versionAfter.tokenVersion).toBe(versionBefore + 1);
    expect(versionAfter.bannedById).toBe(adminId);

    const banLog = await prisma.auditLog.findFirst({
      where: { action: 'USER_BAN', targetId: userId },
    });
    expect(banLog).toMatchObject({
      actorId: adminId,
      actorUsername: adminUsername,
      action: 'USER_BAN',
      targetType: 'USER',
      targetId: userId,
      targetUserId: userId,
      reason: '多次骚扰',
    });
    expect(banLog?.targetLabel).toBe(userUsername);
    expect(banLog?.createdAt).toBeInstanceOf(Date);

    const stale = await post(
      'comments.create',
      { cardSlug, content: '旧会话' },
      userToken,
      '203.0.113.67',
    );
    expect(stale.status).toBe(401);
    expect(stale.body.error.data.appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);

    const again = await login(userUsername, '203.0.113.68');
    expect(again.user.bannedAt).toEqual(expect.any(String));
    expect(again.user).not.toHaveProperty('password');
    const me = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .set('Authorization', `Bearer ${again.token}`)
      .set('X-Forwarded-For', '203.0.113.68');
    expect(me.status).toBe(200);
    expect(resultData(me.body).bannedAt).toEqual(again.user.bannedAt);
    expect(JSON.stringify(me.body)).not.toContain('多次骚扰');

    const blocked: Array<[string, unknown]> = [
      ['comments.create', { cardSlug, content: '不该发出' }],
      ['comments.createForSeries', { seriesSlug, content: '不该发出' }],
      ['forum.topics.create', { title: '不该发出', body: '正文' }],
      ['forum.topics.update', { id: topicId, title: '改标题', body: '改正文' }],
      ['forum.replies.create', { topicId, body: '不该回' }],
      ['listings.publish', { cardSlug, kind: 'BUY', contact: 'still-here' }],
      [
        'reports.create',
        {
          targetType: 'COMMENT',
          targetId: commentId,
          reason: '不该举报',
        },
      ],
    ];
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      for (const [path, body] of blocked) {
        const response = await post(path, body, again.token, '203.0.113.69');
        expect(response.status).toBe(403);
        expect(response.body.error.data.code).toBe('FORBIDDEN');
        expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.USER_BANNED);
        expect(response.body.error.data.stack).toBeUndefined();
        expectNoLeak(response.body);
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }

    const removed = await post('comments.delete', { id: commentId }, again.token, '203.0.113.70');
    expect(removed.status).toBe(200);
    expect(resultData(removed.body)).toEqual({ ok: true });
    expect(
      await prisma.auditLog.count({ where: { action: 'CONTENT_DELETE', targetId: commentId } }),
    ).toBe(0);

    userToken = again.token;
  });

  it('writes one audit row for each moderation action and unban does not bump tokenVersion', async () => {
    const fresh = nextIdentity('govdel');
    const created = await register(fresh);
    const comment = await post(
      'comments.create',
      { cardSlug, content: '留给管理员删' },
      created.token,
      '203.0.113.71',
    );
    const freshCommentId = expectString(resultData(comment.body).id);
    const report = await post(
      'reports.create',
      { targetType: 'TOPIC', targetId: topicId, reason: '请处理这个话题' },
      created.token,
      '203.0.113.72',
    );
    const reportId = expectString(resultData(report.body).id);

    const deleted = await post(
      'comments.delete',
      { id: freshCommentId, reason: '违规' },
      adminToken,
      '203.0.113.73',
    );
    expect(deleted.status).toBe(200);
    const contentLog = await prisma.auditLog.findFirst({
      where: { action: 'CONTENT_DELETE', targetId: freshCommentId },
    });
    expect(contentLog).toMatchObject({
      actorId: adminId,
      targetType: 'COMMENT',
      targetUserId: created.id,
      reason: '违规',
    });

    const resolved = await post(
      'reports.resolve',
      { id: reportId, action: 'MARK_RESOLVED', resolution: '  已看过  ' },
      adminToken,
      '203.0.113.74',
    );
    expect(resolved.status).toBe(200);
    const resolveLogs = await prisma.auditLog.findMany({ where: { targetId: reportId } });
    expect(resolveLogs).toHaveLength(1);
    expect(resolveLogs[0]).toMatchObject({
      action: 'REPORT_RESOLVE',
      targetType: 'REPORT',
      actorId: adminId,
      reason: '已看过',
      targetUserId: userId,
    });

    const versionBefore = (
      await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tokenVersion: true },
      })
    ).tokenVersion;
    const unbanned = await post(
      'admin.users.unban',
      { userId, reason: '误封' },
      adminToken,
      '203.0.113.75',
    );
    expect(unbanned.status).toBe(200);
    expect(resultData(unbanned.body).bannedAt).toBeNull();
    const versionAfter = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tokenVersion: true, bannedAt: true, bannedById: true },
    });
    expect(versionAfter.tokenVersion).toBe(versionBefore);
    expect(versionAfter.bannedAt).toBeNull();
    expect(versionAfter.bannedById).toBeNull();
    const unbanLog = await prisma.auditLog.findFirst({
      where: { action: 'USER_UNBAN', targetId: userId },
    });
    expect(unbanLog?.reason).toBe('误封');

    const audit = await get('admin.audit.list', { user: userUsername, limit: 50 }, adminToken);
    expect(audit.status).toBe(200);
    const actions = (resultData(audit.body).items as Array<{ action: string }>).map(
      (item) => item.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['USER_BAN', 'USER_UNBAN', 'REPORT_RESOLVE']));
  });
});
