import type { INestApplication } from '@nestjs/common';
import { APP_ERROR_CODES, appErrorMessage } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { encodeReleaseCursor } from '../src/modules/releases/release-cursor';

const VALIDATION = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);
const MARK = `rel${Date.now().toString(36)}`;
const EARLY_ID = '00000000-0000-4000-8000-00000000000a';
const MIDDLE_ID = '00000000-0000-4000-8000-00000000000b';
const LATE_ID = '00000000-0000-4000-8000-00000000000c';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected a result object');
  }
  return body.result.data;
}

function readItems(data: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(data.items)) throw new Error('expected items');
  const items: Record<string, unknown>[] = [];
  for (const item of data.items) {
    if (!isRecord(item)) throw new Error('expected items');
    items.push(item);
  }
  return items;
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`expected ${key}`);
  return value;
}

function errorData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.error) || !isRecord(body.error.data)) {
    throw new Error('expected an error');
  }
  return body.error.data;
}

function fieldErrors(body: unknown, field: string): unknown {
  const zodError = errorData(body).zodError;
  if (!isRecord(zodError) || !isRecord(zodError.fieldErrors)) return undefined;
  return zodError.fieldErrors[field];
}

function expectNoLeak(body: unknown): void {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toMatch(
    /Prisma|prisma\.|node_modules|Unexpected token|SyntaxError|ZodError/,
  );
  expect(serialized).not.toMatch(/is not valid JSON|entity\.too\.large|at Object\.|Invocation/);
  expect(serialized).not.toContain('LEAK_MARKER');
  expect(serialized).not.toContain('SELECT ');
}

function isoDay(index: number): string {
  const date = new Date(Date.UTC(2020, 0, 1 + index));
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

describe('release calendar', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken = '';
  let userToken = '';
  const seriesSlug = `${MARK}-series`.slice(0, 64);
  const categorySlug = `${MARK}-cat`.slice(0, 64);

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    const admin = await register('reladm');
    const member = await register('relusr');
    adminToken = admin.token;
    userToken = member.token;
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'admin' } });
  });

  afterEach(async () => {
    if (!prisma) return;
    await prisma.release.deleteMany();
    await prisma.series.deleteMany({ where: { slug: { startsWith: MARK } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: MARK } } });
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, body: unknown, token?: string, ip = '203.0.113.40') {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function get(path: string, input?: unknown, token?: string, ip = '203.0.113.41') {
    const req = request(app.getHttpServer()).get(`/trpc/${path}`).set('X-Forwarded-For', ip);
    if (input !== undefined) req.query({ input: JSON.stringify(input) });
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  }

  async function register(label: string) {
    const suffix = `${Date.now().toString(36)}${label}`;
    const response = await post(
      'auth.register',
      {
        email: `${label}-${suffix}@cardhub.test`,
        username: `${label}${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 24),
        password: 'release-password',
      },
      undefined,
      `198.51.100.${label.length + 20}`,
    );
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    const user = data.user;
    if (!isRecord(user)) throw new Error('expected a user');
    return { token: readString(data, 'token'), id: readString(user, 'id') };
  }

  const validWrite = {
    title: `${MARK}-day`,
    releaseDate: '2031-04-02',
  };

  it('rejects admin procedures without auth or with a bad token as 401, and non-admins as 403', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const calls = [
        () => get('admin.releases.list', { limit: 1 }),
        () => get('admin.releases.list', { limit: 1 }, 'not-a-token'),
        () => post('admin.releases.create', validWrite),
        () => post('admin.releases.create', validWrite, 'not-a-token'),
        () => post('admin.releases.update', { ...validWrite, id: EARLY_ID }),
        () => post('admin.releases.delete', { id: EARLY_ID }),
        () => get('admin.releases.getById', { id: EARLY_ID }),
        () => get('admin.releases.getById', { id: EARLY_ID }, 'not-a-token'),
      ];
      for (const call of calls) {
        const response = await call();
        expect(response.status).toBe(401);
        expect(errorData(response.body).code).toBe('UNAUTHORIZED');
        expect(errorData(response.body).appCode).toBe(APP_ERROR_CODES.UNAUTHORIZED);
        expect(errorData(response.body).stack).toBeUndefined();
        expectNoLeak(response.body);
      }

      const forbidden = [
        () => get('admin.releases.list', { limit: 1 }, userToken),
        () => post('admin.releases.create', validWrite, userToken),
        () => post('admin.releases.update', { ...validWrite, id: EARLY_ID }, userToken),
        () => post('admin.releases.delete', { id: EARLY_ID }, userToken),
        () => get('admin.releases.getById', { id: EARLY_ID }, userToken),
      ];
      for (const call of forbidden) {
        const response = await call();
        expect(response.status).toBe(403);
        expect(errorData(response.body).code).toBe('FORBIDDEN');
        expect(errorData(response.body).appCode).toBe(APP_ERROR_CODES.FORBIDDEN);
        expectNoLeak(response.body);
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('returns 400 for bad dates, region, range, and limit without clamping', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const cases: Array<{
        method: 'get' | 'post';
        path: string;
        input: unknown;
        field: string;
        message: string;
      }> = [
        {
          method: 'post',
          path: 'admin.releases.create',
          input: { ...validWrite, releaseDate: '2026/11/06' },
          field: 'releaseDate',
          message: 'invalid_date',
        },
        {
          method: 'post',
          path: 'admin.releases.create',
          input: { ...validWrite, region: '' },
          field: 'region',
          message: 'release_region',
        },
        {
          method: 'post',
          path: 'admin.releases.create',
          input: { ...validWrite, title: '题'.repeat(121) },
          field: 'title',
          message: 'title_too_long',
        },
        {
          method: 'post',
          path: 'admin.releases.create',
          input: { ...validWrite, note: '注'.repeat(501) },
          field: 'note',
          message: 'release_note_too_long',
        },
        {
          method: 'post',
          path: 'admin.releases.create',
          input: { ...validWrite, sourceUrl: 'http://example.com/source' },
          field: 'sourceUrl',
          message: 'source_url',
        },
        {
          method: 'get',
          path: 'releases.list',
          input: { to: '2031-04-30' },
          field: 'from',
          message: 'invalid_type',
        },
        {
          method: 'get',
          path: 'releases.list',
          input: { from: '2031-04-06', to: '2031-04-01' },
          field: 'to',
          message: 'release_range_order',
        },
        {
          method: 'get',
          path: 'releases.list',
          input: { from: '2024-01-01', to: '2025-01-01' },
          field: 'to',
          message: 'release_range_too_long',
        },
        {
          method: 'get',
          path: 'releases.list',
          input: { from: '2031-04-01', to: '2031-04-30', limit: 0 },
          field: 'limit',
          message: 'too_small',
        },
        {
          method: 'get',
          path: 'releases.list',
          input: { from: '2031-04-01', to: '2031-04-30', limit: 101 },
          field: 'limit',
          message: 'too_big',
        },
        {
          method: 'get',
          path: 'admin.releases.list',
          input: { limit: 0 },
          field: 'limit',
          message: 'too_small',
        },
        {
          method: 'get',
          path: 'admin.releases.list',
          input: { limit: 101 },
          field: 'limit',
          message: 'too_big',
        },
        {
          method: 'get',
          path: 'admin.releases.list',
          input: { limit: 1.5 },
          field: 'limit',
          message: 'invalid_type',
        },
        {
          method: 'get',
          path: 'admin.releases.list',
          input: { limit: '50' },
          field: 'limit',
          message: 'invalid_type',
        },
        {
          method: 'get',
          path: 'admin.releases.list',
          input: { cursor: 'not-a-cursor' },
          field: 'cursor',
          message: 'invalid_format',
        },
        {
          method: 'get',
          path: 'releases.list',
          input: { from: '2031-04-01', to: '2031-04-30', cursor: EARLY_ID },
          field: 'cursor',
          message: 'invalid_format',
        },
      ];

      for (const testCase of cases) {
        const response =
          testCase.method === 'get'
            ? await get(testCase.path, testCase.input, adminToken)
            : await post(testCase.path, testCase.input, adminToken);
        expect(response.status).toBe(400);
        expect(response.body.error.message).toBe(VALIDATION);
        expect(fieldErrors(response.body, testCase.field)).toEqual([testCase.message]);
        expectNoLeak(response.body);
      }

      const leap = await get('releases.list', { from: '2024-01-01', to: '2024-12-31' });
      expect(leap.status).toBe(200);
      expect(readItems(resultData(leap.body))).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('returns 413 for an oversize body and 400 for bad JSON without leaking parser text', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const tooLarge = await request(app.getHttpServer())
        .post('/trpc/admin.releases.create')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', '203.0.113.42')
        .send(Buffer.alloc(100 * 1024 + 1, 0x78));
      expect(tooLarge.status).toBe(413);
      expect(errorData(tooLarge.body).code).toBe('PAYLOAD_TOO_LARGE');
      expect(errorData(tooLarge.body).httpStatus).toBe(413);
      expectNoLeak(tooLarge.body);

      const badJson = await request(app.getHttpServer())
        .post('/trpc/admin.releases.getById')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', '203.0.113.44')
        .send('{"id":"LEAK_MARKER"');
      expect(badJson.status).toBe(400);
      expect(errorData(badJson.body).code).toBe('BAD_REQUEST');
      expect(errorData(badJson.body).appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
      expectNoLeak(badJson.body);

      const tooLargeById = await request(app.getHttpServer())
        .post('/trpc/admin.releases.getById')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', '203.0.113.45')
        .send(Buffer.alloc(100 * 1024 + 1, 0x78));
      expect(tooLargeById.status).toBe(413);
      expect(errorData(tooLargeById.body).code).toBe('PAYLOAD_TOO_LARGE');
      expect(errorData(tooLargeById.body).httpStatus).toBe(413);
      expectNoLeak(tooLargeById.body);

      const badCreate = await request(app.getHttpServer())
        .post('/trpc/admin.releases.create')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', '203.0.113.43')
        .send('{"title":"LEAK_MARKER"');
      expect(badCreate.status).toBe(400);
      expect(errorData(badCreate.body).code).toBe('BAD_REQUEST');
      expect(errorData(badCreate.body).appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
      expectNoLeak(badCreate.body);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('returns one release from getById and not found when the id is missing', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const created = await post('admin.releases.create', validWrite, adminToken);
      expect(created.status).toBe(200);
      const id = readString(resultData(created.body), 'id');
      const found = await get('admin.releases.getById', { id }, adminToken);
      expect(found.status).toBe(200);
      expect(readString(resultData(found.body), 'title')).toBe(validWrite.title);
      expect(readString(resultData(found.body), 'releaseDate')).toBe(validWrite.releaseDate);
      const missing = await get('admin.releases.getById', { id: EARLY_ID }, adminToken);
      expect(missing.status).toBe(404);
      expect(errorData(missing.body).code).toBe('NOT_FOUND');
      expect(errorData(missing.body).stack).toBeUndefined();
      expectNoLeak(missing.body);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('lists a closed Shanghai interval with series and category in one row', async () => {
    const originalFetch = global.fetch;
    global.fetch = () => {
      throw new Error('source url was fetched');
    };
    try {
      const category = await prisma.category.create({
        data: { slug: categorySlug, name: '构筑' },
      });
      const series = await prisma.series.create({
        data: {
          slug: seriesSlug,
          title: '夜航系列',
          coverUrl: 'https://cdn.example.com/cover.png',
        },
      });
      const created = await post(
        'admin.releases.create',
        {
          title: `${MARK}-linked`,
          releaseDate: '2031-04-02',
          region: 'JP',
          seriesId: series.id,
          categoryId: category.id,
          note: '备注',
          sourceUrl: 'https://releases.invalid/source',
          status: 'PUBLISHED',
          imageUrl: 'https://cdn.example.com/ignored.png',
        },
        adminToken,
      );
      expect(created.status).toBe(200);
      const item = resultData(created.body);
      expect(item).toMatchObject({
        title: `${MARK}-linked`,
        releaseDate: '2031-04-02',
        datePrecision: 'DAY',
        region: 'JP',
        seriesId: series.id,
        categoryId: category.id,
        note: '备注',
        sourceUrl: 'https://releases.invalid/source',
        series: {
          slug: seriesSlug,
          title: '夜航系列',
          coverUrl: 'https://cdn.example.com/cover.png',
        },
        category: { slug: categorySlug, name: '构筑' },
      });
      expect(item).not.toHaveProperty('status');
      expect(item).not.toHaveProperty('imageUrl');
      expect(item).not.toHaveProperty('coverUrl');

      const omitted = await post(
        'admin.releases.create',
        { title: `${MARK}-open`, releaseDate: '2031-04-01', region: null },
        adminToken,
      );
      expect(omitted.status).toBe(200);
      expect(resultData(omitted.body).region).toBeNull();

      const outside = await post(
        'admin.releases.create',
        { title: `${MARK}-out`, releaseDate: '2031-05-01' },
        adminToken,
      );
      expect(outside.status).toBe(200);

      const listed = await get('releases.list', { from: '2031-04-01', to: '2031-04-02' });
      expect(listed.status).toBe(200);
      const items = readItems(resultData(listed.body));
      expect(items.map((row) => readString(row, 'releaseDate'))).toEqual([
        '2031-04-01',
        '2031-04-02',
      ]);
      expect(items[1]?.series).toEqual({
        slug: seriesSlug,
        title: '夜航系列',
        coverUrl: 'https://cdn.example.com/cover.png',
      });

      const filtered = await get('releases.list', {
        from: '2031-04-01',
        to: '2031-04-30',
        categorySlug,
      });
      expect(readItems(resultData(filtered.body)).map((row) => row.title)).toEqual([
        `${MARK}-linked`,
      ]);
      const unknown = await get('releases.list', {
        from: '2031-04-01',
        to: '2031-04-30',
        categorySlug: 'missing-category',
      });
      expect(readItems(resultData(unknown.body))).toEqual([]);

      await prisma.series.delete({ where: { id: series.id } });
      const afterDelete = await get('releases.list', { from: '2031-04-02', to: '2031-04-02' });
      const remaining = readItems(resultData(afterDelete.body));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.seriesId).toBeNull();
      expect(remaining[0]?.series).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('stores MONTH precision on the first day and keeps DAY dates', async () => {
    const created = await post(
      'admin.releases.create',
      { title: `${MARK}-month`, releaseDate: '2032-02-15', datePrecision: 'MONTH' },
      adminToken,
    );
    expect(created.status).toBe(200);
    expect(resultData(created.body)).toMatchObject({
      releaseDate: '2032-02-01',
      datePrecision: 'MONTH',
    });
    const onFirst = await get('releases.list', { from: '2032-02-01', to: '2032-02-01' });
    expect(readItems(resultData(onFirst.body))).toHaveLength(1);

    await post(
      'admin.releases.create',
      { title: `${MARK}-feb1`, releaseDate: '2032-02-01', datePrecision: 'DAY' },
      adminToken,
    );
    await post(
      'admin.releases.create',
      { title: `${MARK}-feb15`, releaseDate: '2032-02-15', datePrecision: 'DAY' },
      adminToken,
    );
    const overlapped = await get('releases.list', {
      from: '2032-02-15',
      to: '2032-02-20',
      limit: 10,
    });
    const rows = readItems(resultData(overlapped.body));
    expect(rows.map((row) => readString(row, 'title'))).toEqual([`${MARK}-month`, `${MARK}-feb15`]);
    expect(rows.map((row) => readString(row, 'releaseDate'))).toEqual(['2032-02-01', '2032-02-15']);
    const monthCursor = encodeReleaseCursor('2032-02-01', readString(rows[0] ?? {}, 'id'));
    const afterMonth = await get('releases.list', {
      from: '2032-02-15',
      to: '2032-02-20',
      cursor: monthCursor,
      limit: 10,
    });
    expect(readItems(resultData(afterMonth.body)).map((row) => readString(row, 'title'))).toEqual([
      `${MARK}-feb15`,
    ]);
  });

  it('writes a content-delete audit row when an admin deletes a release', async () => {
    const created = await post(
      'admin.releases.create',
      { title: `${MARK}-audit`, releaseDate: '2034-01-04' },
      adminToken,
    );
    const id = readString(resultData(created.body), 'id');
    const removed = await post('admin.releases.delete', { id, reason: '  重复条目  ' }, adminToken);
    expect(removed.status).toBe(200);
    const entry = await prisma.auditLog.findFirst({
      where: { targetId: id, action: 'CONTENT_DELETE' },
    });
    expect(entry).toMatchObject({
      targetType: 'RELEASE',
      targetId: id,
      targetLabel: `${MARK}-audit`,
      targetUserId: null,
      reason: '重复条目',
    });
    const missing = await post('admin.releases.delete', { id }, adminToken);
    expect(missing.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { targetId: id } })).toBe(1);
  });

  it('orders each list in its own direction and continues a keyset after a missing row', async () => {
    await prisma.release.createMany({
      data: [
        { id: EARLY_ID, title: `${MARK}-early`, releaseDate: new Date(Date.UTC(2031, 5, 1)) },
        { id: LATE_ID, title: `${MARK}-late`, releaseDate: new Date(Date.UTC(2031, 5, 1)) },
      ],
    });
    const range = { from: '2031-06-01', to: '2031-06-01' };
    const ascending = await get('releases.list', range);
    expect(readItems(resultData(ascending.body)).map((row) => row.id)).toEqual([EARLY_ID, LATE_ID]);

    const forward = encodeReleaseCursor('2031-06-01', MIDDLE_ID);
    const afterMissing = await get('releases.list', { ...range, cursor: forward, limit: 10 });
    expect(readItems(resultData(afterMissing.body)).map((row) => row.id)).toEqual([LATE_ID]);

    const descending = await get('admin.releases.list', { limit: 10 }, adminToken);
    expect(readItems(resultData(descending.body)).map((row) => row.id)).toEqual([
      LATE_ID,
      EARLY_ID,
    ]);

    const backward = encodeReleaseCursor('2031-06-01', MIDDLE_ID);
    const adminAfterMissing = await get(
      'admin.releases.list',
      { cursor: backward, limit: 10 },
      adminToken,
    );
    expect(readItems(resultData(adminAfterMissing.body)).map((row) => row.id)).toEqual([EARLY_ID]);

    await prisma.release.delete({ where: { id: LATE_ID } });
    const page = await get('admin.releases.list', { cursor: backward, limit: 1 }, adminToken);
    expect(page.status).toBe(200);
    expect(readItems(resultData(page.body)).map((row) => row.id)).toEqual([EARLY_ID]);
  });

  it('defaults the admin page to 50 and does not cap a public range', async () => {
    await prisma.release.createMany({
      data: Array.from({ length: 51 }, (_, index) => ({
        title: `${MARK}-n-${String(index).padStart(2, '0')}`,
        releaseDate: new Date(Date.UTC(2020, 0, 1 + index)),
      })),
    });
    const everyone = await get('releases.list', { from: '2020-01-01', to: '2020-12-31' });
    const publicItems = readItems(resultData(everyone.body));
    expect(publicItems).toHaveLength(50);
    expect(readString(publicItems[0] ?? {}, 'releaseDate')).toBe(isoDay(0));
    expect(readString(publicItems[49] ?? {}, 'releaseDate')).toBe(isoDay(49));
    const publicCursor = resultData(everyone.body).nextCursor;
    expect(typeof publicCursor).toBe('string');
    const publicRest = await get('releases.list', {
      from: '2020-01-01',
      to: '2020-12-31',
      cursor: publicCursor,
    });
    expect(
      readItems(resultData(publicRest.body)).map((row) => readString(row, 'releaseDate')),
    ).toEqual([isoDay(50)]);

    const adminPage = await get('admin.releases.list', {}, adminToken);
    expect(adminPage.status).toBe(200);
    const adminItems = readItems(resultData(adminPage.body));
    expect(adminItems).toHaveLength(50);
    expect(readString(adminItems[0] ?? {}, 'releaseDate')).toBe(isoDay(50));
    expect(readString(adminItems[49] ?? {}, 'releaseDate')).toBe(isoDay(1));
    const nextCursor = resultData(adminPage.body).nextCursor;
    expect(typeof nextCursor).toBe('string');

    const boundaryId = readString(adminItems[49] ?? {}, 'id');
    await prisma.release.delete({ where: { id: boundaryId } });
    const nextPage = await get('admin.releases.list', { cursor: nextCursor }, adminToken);
    expect(nextPage.status).toBe(200);
    expect(
      readItems(resultData(nextPage.body)).map((row) => readString(row, 'releaseDate')),
    ).toEqual([isoDay(0)]);
  });
});
