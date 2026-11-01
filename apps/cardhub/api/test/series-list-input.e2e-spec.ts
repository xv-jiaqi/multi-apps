import type { INestApplication } from '@nestjs/common';
import { APP_ERROR_CODES, appErrorMessage } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const CH114 = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);
const LEAK_MARKER = 'SERIES_LIST_PARSER_LEAK';

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value;
}

function expectNoInternals(body: unknown, marker?: string) {
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('Unexpected token');
  expect(serialized).not.toContain('is not valid JSON');
  expect(serialized).not.toContain('SyntaxError');
  expect(serialized).not.toContain('ZodError');
  expect(serialized).not.toContain('prisma');
  expect(serialized).not.toContain('PrismaClient');
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toContain('invocation');
  if (marker) expect(serialized).not.toContain(marker);
}

function resultItems(body: unknown): Array<Record<string, unknown>> {
  const data = record(record(body)?.result)?.data;
  const items = record(data)?.items;
  if (!Array.isArray(items)) throw new Error('expected series.list items');
  return items.flatMap((item) => {
    const row = record(item);
    return row ? [row] : [];
  });
}

describe('series.list releasedOnOrBefore', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
  const earlySlug = `rel-early-${suffix}`.slice(0, 64);
  const boundarySlug = `rel-bound-${suffix}`.slice(0, 64);
  const laterSlug = `rel-later-${suffix}`.slice(0, 64);
  const undatedSlug = `rel-none-${suffix}`.slice(0, 64);
  const slugs = [earlySlug, boundarySlug, laterSlug, undatedSlug];
  const month = 1 + Math.floor(Math.random() * 12);
  const boundaryDay = 10 + Math.floor(Math.random() * 10);
  const earlyDate = `1111-${String(month).padStart(2, '0')}-${String(boundaryDay - 1).padStart(2, '0')}`;
  const boundaryDate = `1111-${String(month).padStart(2, '0')}-${String(boundaryDay).padStart(2, '0')}`;
  const laterDate = `1111-${String(month).padStart(2, '0')}-${String(boundaryDay + 1).padStart(2, '0')}`;

  function utcDate(isoDate: string): Date {
    const [year, monthPart, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(year ?? 0, (monthPart ?? 1) - 1, day ?? 1));
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.series.deleteMany({
      where: {
        OR: [
          { slug: { in: slugs } },
          {
            releaseDate: {
              gte: new Date(Date.UTC(1111, 0, 1)),
              lt: new Date(Date.UTC(1112, 0, 1)),
            },
          },
        ],
      },
    });
    await prisma.series.createMany({
      data: [
        {
          slug: earlySlug,
          title: 'Early bound',
          releaseDate: utcDate(earlyDate),
        },
        {
          slug: boundarySlug,
          title: 'Boundary day',
          releaseDate: utcDate(boundaryDate),
        },
        {
          slug: laterSlug,
          title: 'After cutoff',
          releaseDate: utcDate(laterDate),
        },
        { slug: undatedSlug, title: 'Undated series' },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) await prisma.series.deleteMany({ where: { slug: { in: slugs } } });
    await app?.close();
  });

  function list(input: unknown) {
    return request(app.getHttpServer())
      .get('/trpc/series.list')
      .query({ input: JSON.stringify(input) })
      .set('X-Forwarded-For', '203.0.113.40');
  }

  it('returns 400 for a bad releasedOnOrBefore without leaking internals', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await list({ releasedOnOrBefore: '2024-02-31', sort: 'releaseDateDesc' });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe(CH114);
      expect(response.body.error.data).toEqual(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          httpStatus: 400,
          appCode: APP_ERROR_CODES.VALIDATION,
          path: 'series.list',
        }),
      );
      expect(response.body.error.data.stack).toBeUndefined();
      expect(response.body.error.data.zodError.fieldErrors.releasedOnOrBefore).toEqual([
        'invalid_date',
      ]);
      expectNoInternals(response.body);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('returns 413 for an oversize body and 400 for bad JSON without leaking internals', async () => {
    const tooLarge = await request(app.getHttpServer())
      .post('/trpc/series.list')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.41')
      .send(Buffer.alloc(100 * 1024 + 1, 0x78));

    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data.httpStatus).toBe(413);
    expect(tooLarge.body.error.data.appCode).toBe(APP_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expectNoInternals(tooLarge.body);

    const badJson = await request(app.getHttpServer())
      .post('/trpc/series.list')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.42')
      .send(`{"releasedOnOrBefore":"${LEAK_MARKER}"`);

    expect(badJson.status).toBe(400);
    expect(badJson.body.error.message).toBe('请求无法解析，请重试');
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
    expectNoInternals(badJson.body, LEAK_MARKER);
  });

  it('keeps only release dates on or before the cutoff, newest first', async () => {
    const page = await list({
      releasedOnOrBefore: boundaryDate,
      sort: 'releaseDateDesc',
      page: 1,
      pageSize: 1,
    });
    expect(page.status).toBe(200);
    const first = resultItems(page.body)[0];
    expect(first?.slug).toBe(boundarySlug);
    expect(first?.releaseDate).toBe(boundaryDate);

    const all = await list({
      releasedOnOrBefore: boundaryDate,
      sort: 'releaseDateDesc',
      page: 1,
      pageSize: 100,
    });
    expect(all.status).toBe(200);
    const slugsOnPage = resultItems(all.body).map((item) => item.slug);
    expect(slugsOnPage).toContain(boundarySlug);
    expect(slugsOnPage).toContain(earlySlug);
    expect(slugsOnPage).not.toContain(laterSlug);
    expect(slugsOnPage).not.toContain(undatedSlug);
  });
});
