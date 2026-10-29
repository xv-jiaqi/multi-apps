import type { INestApplication } from '@nestjs/common';
import {
  APP_ERROR_CODES,
  appErrorMessage,
  formatUtcCalendarDate,
  utcCalendarDate,
  utcCalendarDateFromInstant,
} from '@repo/shared';
import request from 'supertest';
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
  return data as Record<string, unknown>;
}

function day(isoDate: string): Date {
  const parsed = utcCalendarDate(isoDate);
  if (!parsed) throw new Error(`invalid date ${isoDate}`);
  return parsed;
}

function at(isoInstant: string): Date {
  return new Date(isoInstant);
}

describe('admin.metrics', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken = '';
  let userToken = '';
  const createdUserIds: string[] = [];
  const createdSeriesIds: string[] = [];

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const admin = nextIdentity('metadm');
    const member = nextIdentity('metusr');
    const adminUser = await register(admin);
    const user = await register(member);
    adminToken = adminUser.token;
    userToken = user.token;
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'admin' } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.userDailyActivity.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.comment.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma.series.deleteMany({ where: { id: { in: createdSeriesIds } } });
    }
    await app?.close();
  });

  function post(path: string, body: unknown, token?: string, ip = '203.0.113.80') {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function get(path: string, input?: unknown, token?: string, ip = '203.0.113.81') {
    const req = request(app.getHttpServer()).get(`/trpc/${path}`).set('X-Forwarded-For', ip);
    if (input !== undefined) req.query({ input: JSON.stringify(input) });
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  }

  async function register(identity: ReturnType<typeof nextIdentity>) {
    const response = await post(
      'auth.register',
      {
        email: identity.email,
        username: identity.username,
        password: 'metrics-password',
      },
      undefined,
      identity.ip,
    );
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (typeof user !== 'object' || user === null || !('id' in user)) {
      throw new Error('expected a user');
    }
    return { token: expectString(data.token), id: expectString((user as { id: unknown }).id) };
  }

  async function clearFixtureWindow() {
    const activityFrom = day('2001-01-01');
    const activityTo = day('2001-06-10');
    const createdFrom = at('2001-01-01T00:00:00.000Z');
    const createdTo = at('2001-06-03T00:00:00.000Z');
    await prisma.comment.deleteMany({
      where: { createdAt: { gte: createdFrom, lt: createdTo } },
    });
    await prisma.userDailyActivity.deleteMany({
      where: { day: { gte: activityFrom, lte: activityTo } },
    });
    await prisma.user.deleteMany({
      where: { createdAt: { gte: createdFrom, lt: createdTo } },
    });
  }

  async function fixtureUser(label: string, createdAt: string) {
    sequence += 1;
    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@cardhub.test`,
        username: `${label}${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 24),
        password: 'metrics-fixture',
        createdAt: at(createdAt),
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function active(userId: string, isoDate: string) {
    await prisma.userDailyActivity.create({
      data: { userId, day: day(isoDate) },
    });
  }

  it('aggregates constructed registrations, activity, and comments', async () => {
    await clearFixtureWindow();

    const ada = await fixtureUser('metada', '2001-04-01T08:00:00.000Z');
    const bea = await fixtureUser('metbea', '2001-04-01T18:00:00.000Z');
    const cy = await fixtureUser('metcy', '2001-04-02T00:30:00.000Z');
    const dee = await fixtureUser('metdee', '2001-04-10T12:00:00.000Z');
    const eli = await fixtureUser('meteli', '2001-03-15T12:00:00.000Z');
    const gus = await fixtureUser('metgus', '2001-05-01T00:00:00.000Z');

    await active(ada.id, '2001-04-01');
    await active(ada.id, '2001-04-02');
    await active(ada.id, '2001-04-08');
    await active(bea.id, '2001-04-02');
    await active(cy.id, '2001-04-09');
    await active(eli.id, '2001-04-01');
    await active(eli.id, '2001-04-15');
    await active(gus.id, '2001-04-30');

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const series = await prisma.series.create({
      data: { slug: `metrics-series-${suffix}`.slice(0, 64), title: '指标系列' },
    });
    createdSeriesIds.push(series.id);
    const card = await prisma.card.create({
      data: { slug: `metrics-card-${suffix}`.slice(0, 64), name: '指标卡', seriesId: series.id },
    });
    const parent = await prisma.comment.create({
      data: {
        content: '四月一日',
        userId: ada.id,
        cardId: card.id,
        createdAt: at('2001-04-01T01:00:00.000Z'),
      },
    });
    await prisma.comment.createMany({
      data: [
        ...[2, 3, 4, 5].map((hour) => ({
          content: `四月一日${hour}`,
          userId: ada.id,
          cardId: card.id,
          createdAt: at(`2001-04-01T0${hour}:00:00.000Z`),
        })),
        ...[1, 2, 3].map((hour) => ({
          content: `四月十五${hour}`,
          userId: bea.id,
          cardId: card.id,
          createdAt: at(`2001-04-15T0${hour}:00:00.000Z`),
        })),
        {
          content: '四月三十',
          userId: cy.id,
          cardId: card.id,
          createdAt: at('2001-04-30T23:30:00.000Z'),
        },
        {
          content: '三月三十一',
          userId: ada.id,
          cardId: card.id,
          createdAt: at('2001-03-31T23:00:00.000Z'),
        },
        {
          content: '五月一日',
          userId: gus.id,
          cardId: card.id,
          createdAt: at('2001-05-01T00:00:00.000Z'),
        },
      ],
    });
    await prisma.comment.create({
      data: {
        content: '四月一日回复',
        userId: dee.id,
        cardId: card.id,
        parentId: parent.id,
        createdAt: at('2001-04-01T06:00:00.000Z'),
      },
    });

    const april = await get(
      'admin.metrics',
      { from: '2001-04-01', to: '2001-04-30' },
      adminToken,
      '203.0.113.90',
    );
    expect(april.status).toBe(200);
    const aprilBody = resultData(april.body);
    const byDay = aprilBody.registrations as {
      total: number;
      byDay: Array<{ date: string; count: number }>;
    };
    expect(byDay.byDay).toHaveLength(30);
    expect(byDay.byDay[0]).toEqual({ date: '2001-04-01', count: 2 });
    expect(byDay.byDay[1]).toEqual({ date: '2001-04-02', count: 1 });
    expect(byDay.byDay[2]).toEqual({ date: '2001-04-03', count: 0 });
    expect(byDay.byDay[9]).toEqual({ date: '2001-04-10', count: 1 });
    expect(byDay.byDay[29]).toEqual({ date: '2001-04-30', count: 0 });
    expect(byDay.byDay.reduce((sum, row) => sum + row.count, 0)).toBe(4);

    expect(aprilBody).toMatchObject({
      from: '2001-04-01',
      to: '2001-04-30',
      dayCount: 30,
      mau: {
        activeUsers: 5,
        byMonth: [{ month: '2001-04', activeUsers: 5 }],
      },
      registrations: { total: 4 },
      retention: {
        nextDay: { cohortUsers: 4, retainedUsers: 2, rate: 0.5 },
        day7: { cohortUsers: 4, retainedUsers: 2, rate: 0.5 },
      },
      comments: { total: 10, perDay: 0.3333 },
    });
    const serialized = JSON.stringify(aprilBody);
    expect(serialized).not.toContain('@cardhub.test');
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain(ada.id);

    const span = await get(
      'admin.metrics',
      { from: '2001-04-15', to: '2001-05-01' },
      adminToken,
      '203.0.113.91',
    );
    expect(span.status).toBe(200);
    expect(resultData(span.body)).toMatchObject({
      from: '2001-04-15',
      to: '2001-05-01',
      dayCount: 17,
      mau: {
        activeUsers: 2,
        byMonth: [
          { month: '2001-04', activeUsers: 2 },
          { month: '2001-05', activeUsers: 0 },
        ],
      },
      registrations: { total: 1 },
      retention: {
        nextDay: { cohortUsers: 1, retainedUsers: 0, rate: 0 },
        day7: { cohortUsers: 1, retainedUsers: 0, rate: 0 },
      },
      comments: { total: 5, perDay: 0.2941 },
    });
    const spanDays = (
      resultData(span.body).registrations as { byDay: Array<{ date: string; count: number }> }
    ).byDay;
    expect(spanDays).toHaveLength(17);
    expect(spanDays.find((row) => row.date === '2001-05-01')).toEqual({
      date: '2001-05-01',
      count: 1,
    });
    expect(spanDays.find((row) => row.date === '2001-04-15')).toEqual({
      date: '2001-04-15',
      count: 0,
    });

    const empty = await get(
      'admin.metrics',
      { from: '2001-01-01', to: '2001-01-03' },
      adminToken,
      '203.0.113.92',
    );
    expect(empty.status).toBe(200);
    const emptyBody = resultData(empty.body);
    expect(emptyBody).toMatchObject({
      dayCount: 3,
      mau: { activeUsers: 0, byMonth: [{ month: '2001-01', activeUsers: 0 }] },
      registrations: { total: 0 },
      retention: {
        nextDay: { cohortUsers: 0, retainedUsers: 0, rate: null },
        day7: { cohortUsers: 0, retainedUsers: 0, rate: null },
      },
      comments: { total: 0, perDay: 0 },
    });
    const emptyDays = (emptyBody.registrations as { byDay: unknown[] }).byDay;
    expect(emptyDays).toEqual([
      { date: '2001-01-01', count: 0 },
      { date: '2001-01-02', count: 0 },
      { date: '2001-01-03', count: 0 },
    ]);
  });

  it('rejects anonymous callers with UNAUTHORIZED and non-admins with FORBIDDEN', async () => {
    const input = { from: '2001-04-01', to: '2001-04-02' };
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const anonymous = await get('admin.metrics', input, undefined, '203.0.113.93');
      expect(anonymous.status).toBe(401);
      expect(anonymous.body.error.data.code).toBe('UNAUTHORIZED');
      expect(anonymous.body.error.data.appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
      expect(anonymous.body.error.data.stack).toBeUndefined();

      const member = await get('admin.metrics', input, userToken, '203.0.113.94');
      expect(member.status).toBe(403);
      expect(member.body.error.data.code).toBe('FORBIDDEN');
      expect(member.body.error.data.appCode).toBe(APP_ERROR_CODES.FORBIDDEN);
      expect(member.body.error.message).toBe('仅管理员可管理内容');
      expect(member.body.error.data.stack).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('rejects an inverted range, an impossible day, and a span over 366 days', async () => {
    const cases = [
      {
        input: { from: '2001-04-02', to: '2001-04-01' },
        path: 'to',
        message: 'metrics_range_order',
      },
      {
        input: { from: '2001-02-31', to: '2001-03-01' },
        path: 'from',
        message: 'invalid_date',
      },
      {
        input: { from: '2024-01-01', to: '2025-01-01' },
        path: 'to',
        message: 'metrics_range_too_long',
      },
    ];

    for (const testCase of cases) {
      const response = await get('admin.metrics', testCase.input, adminToken, '203.0.113.95');
      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe(
        appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION),
      );
      expect(response.body.error.data.appCode).toBe(APP_ERROR_CODES.VALIDATION);
      expect(response.body.error.data.zodError.fieldErrors[testCase.path]).toEqual([
        testCase.message,
      ]);
    }

    const accepted = await get(
      'admin.metrics',
      { from: '2024-01-01', to: '2024-12-31' },
      adminToken,
      '203.0.113.96',
    );
    expect(accepted.status).toBe(200);
    expect(resultData(accepted.body).dayCount).toBe(366);
  });

  it('keeps a single activity row when the same user calls twice on the same UTC day', async () => {
    const identity = nextIdentity('metday');
    const registered = await register(identity);
    createdUserIds.push(registered.id);

    expect(await prisma.userDailyActivity.count({ where: { userId: registered.id } })).toBe(0);

    await prisma.userDailyActivity.create({
      data: { userId: registered.id, day: day('2001-04-01') },
    });

    const [first, second] = await Promise.all([
      get('auth.me', undefined, registered.token, '203.0.113.97'),
      get('auth.me', undefined, registered.token, '203.0.113.98'),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const third = await get('auth.me', undefined, registered.token, '203.0.113.99');
    expect(third.status).toBe(200);

    const anonymous = await get('health.ping', undefined, undefined, '203.0.113.100');
    expect(anonymous.status).toBe(200);

    let rows: Array<{ day: Date; userId: string }> = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      rows = await prisma.userDailyActivity.findMany({
        where: { userId: registered.id },
        orderBy: { day: 'asc' },
        select: { day: true, userId: true },
      });
      if (rows.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const today = formatUtcCalendarDate(utcCalendarDateFromInstant(new Date()));
    expect(rows.map((row) => formatUtcCalendarDate(row.day))).toEqual(['2001-04-01', today]);
    expect(rows.every((row) => row.userId === registered.id)).toBe(true);
    expect(
      await prisma.userDailyActivity.count({ where: { userId: registered.id, day: day(today) } }),
    ).toBe(1);
  });

  it('does not put a user who registered today into the next-day cohort', async () => {
    const createdAt = new Date();
    const today = formatUtcCalendarDate(utcCalendarDateFromInstant(createdAt));
    const registeredToday = await fixtureUser('mettoday', createdAt.toISOString());
    expect(formatUtcCalendarDate(utcCalendarDateFromInstant(registeredToday.createdAt))).toBe(
      today,
    );

    const response = await get(
      'admin.metrics',
      { from: today, to: today },
      adminToken,
      '203.0.113.101',
    );
    expect(response.status).toBe(200);
    const body = resultData(response.body);
    const registrations = body.registrations as { total: number };
    expect(registrations.total).toBeGreaterThanOrEqual(1);
    expect(body.retention).toEqual({
      nextDay: { cohortUsers: 0, retainedUsers: 0, rate: null },
      day7: { cohortUsers: 0, retainedUsers: 0, rate: null },
    });
  });

  it('counts a UTC midnight timestamp on that calendar day and excludes the previous millisecond', async () => {
    await clearFixtureWindow();
    const onMidnight = await fixtureUser('metmid', '2001-06-01T00:00:00.000Z');
    const nextMidnight = await fixtureUser('metnxt', '2001-06-02T00:00:00.000Z');
    await fixtureUser('metprev', '2001-05-31T23:59:59.999Z');
    await active(onMidnight.id, '2001-06-02');

    const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
    const series = await prisma.series.create({
      data: { slug: `metrics-midnight-${suffix}`.slice(0, 64), title: '午夜' },
    });
    createdSeriesIds.push(series.id);
    const card = await prisma.card.create({
      data: {
        slug: `metrics-midnight-card-${suffix}`.slice(0, 64),
        name: '午夜卡',
        seriesId: series.id,
      },
    });
    await prisma.comment.createMany({
      data: [
        {
          content: '六月一日零点',
          userId: onMidnight.id,
          cardId: card.id,
          createdAt: at('2001-06-01T00:00:00.000Z'),
        },
        {
          content: '五月三十一末',
          userId: onMidnight.id,
          cardId: card.id,
          createdAt: at('2001-05-31T23:59:59.999Z'),
        },
        {
          content: '六月二日零点',
          userId: nextMidnight.id,
          cardId: card.id,
          createdAt: at('2001-06-02T00:00:00.000Z'),
        },
      ],
    });

    const response = await get(
      'admin.metrics',
      { from: '2001-06-01', to: '2001-06-01' },
      adminToken,
      '203.0.113.102',
    );
    expect(response.status).toBe(200);
    const body = resultData(response.body);
    const registrations = body.registrations as {
      total: number;
      byDay: Array<{ date: string; count: number }>;
    };
    expect(registrations).toEqual({
      total: 1,
      byDay: [{ date: '2001-06-01', count: 1 }],
    });
    expect(body.comments).toEqual({ total: 1, perDay: 1 });
    expect(body.retention).toEqual({
      nextDay: { cohortUsers: 1, retainedUsers: 1, rate: 1 },
      day7: { cohortUsers: 1, retainedUsers: 0, rate: 0 },
    });
  });
});
