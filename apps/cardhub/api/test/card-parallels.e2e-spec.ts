import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, appErrorMessage } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const VALIDATION = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);
const PARSE_ERROR = appErrorMessage('zh-CN', APP_ERROR_CODES.PARSE_ERROR);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function resultData(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.result.data)) {
    throw new Error('expected tRPC result data');
  }
  return body.result.data;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`expected ${key}`);
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`expected ${key}`);
  return value;
}

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'number') throw new Error(`expected ${key}`);
  return value;
}

function whole(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw new Error(`expected ${key}`);
  return value;
}

function rowsOf(body: unknown, key: string): Record<string, unknown>[] {
  const value = resultData(body)[key];
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`expected ${key}`);
  return value;
}

function fieldErrors(body: unknown, field: string): string[] {
  if (!isRecord(body) || !isRecord(body.error) || !isRecord(body.error.data)) {
    throw new Error('expected error');
  }
  const zodError = body.error.data.zodError;
  if (!isRecord(zodError) || !isRecord(zodError.fieldErrors)) {
    throw new Error('expected fieldErrors');
  }
  const messages = zodError.fieldErrors[field];
  if (!isStringArray(messages)) throw new Error(`expected ${field} errors`);
  return messages;
}

function assertNoInternalText(body: unknown): void {
  // Development keeps data.stack. Production deletes it in the error formatter.
  // Judge the payload clients see in production.
  let serialized = JSON.stringify(body);
  if (isRecord(body) && isRecord(body.error) && isRecord(body.error.data)) {
    const data = { ...body.error.data };
    delete data.stack;
    serialized = JSON.stringify({ ...body, error: { ...body.error, data } });
  }
  expect(serialized).not.toContain('ZodError');
  expect(serialized).not.toContain('Prisma');
  expect(serialized).not.toContain('invocation');
  expect(serialized).not.toContain('Unexpected token');
  expect(serialized).not.toContain('is not valid JSON');
  expect(serialized).not.toContain('Invalid input');
  expect(serialized).not.toContain('Too big');
  expect(serialized).not.toContain('Too small');
  expect(serialized).not.toContain('entity.too.large');
  expect(serialized).not.toContain('request entity too large');
  expect(serialized).not.toContain('SyntaxError');
  expect(serialized).not.toContain('node_modules');
}

describe('card parallels', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const seriesSlug = `p-set-${suffix}`;
  const otherSlug = `p-other-${suffix}`;
  const adminEmail = `p-admin-${suffix}@cardhub.test`;
  const userEmail = `p-user-${suffix}@cardhub.test`;
  const parallelUserEmail = `p-only-${suffix}@cardhub.test`;
  let adminToken = '';
  let userToken = '';
  let parallelUserToken = '';

  const slug = (name: string) => `${name}-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = await registerAdmin(adminEmail, `padm${suffix}`.slice(0, 24), '203.0.113.140');
    userToken = await registerUser(userEmail, `pusr${suffix}`.slice(0, 24), '203.0.113.141');
    parallelUserToken = await registerUser(
      parallelUserEmail,
      `pply${suffix}`.slice(0, 24),
      '203.0.113.142',
    );

    await post('admin.series.create', { slug: seriesSlug, title: '平行系列' }, adminToken);
    await post('admin.series.create', { slug: otherSlug, title: '另一个系列' }, adminToken);
    await createCard({ slug: slug('base'), name: '基础', seriesSlug, cardNumber: '7' });
    await createCard({ slug: slug('loose'), name: '旧卡', seriesSlug, cardNumber: '8' });
    await createCard({
      slug: slug('other-base'),
      name: '外系列',
      seriesSlug: otherSlug,
      cardNumber: '1',
    });
    await createCard({
      slug: slug('plain'),
      name: '无号卡',
      seriesSlug,
      cardNumber: '7',
      parallelOfSlug: slug('base'),
      parallelName: '无号',
      printRun: null,
    });
    await createCard({
      slug: slug('alpha'),
      name: '十限甲',
      seriesSlug,
      cardNumber: '7',
      parallelOfSlug: slug('base'),
      parallelName: 'alpha',
      printRun: 10,
    });
    await createCard({
      slug: slug('gold'),
      name: '十限',
      seriesSlug,
      cardNumber: '7',
      parallelOfSlug: slug('base'),
      parallelName: 'beta',
      printRun: 10,
    });
    await createCard({
      slug: slug('low'),
      name: '二限',
      seriesSlug,
      cardNumber: '7',
      parallelOfSlug: slug('base'),
      parallelName: 'two',
      printRun: 2,
    });
    await createCard({
      slug: slug('early'),
      name: '早号',
      seriesSlug,
      cardNumber: '1',
      parallelOfSlug: slug('base'),
      parallelName: 'early',
      printRun: 99,
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({ where: { slug: { in: [seriesSlug, otherSlug] } } });
      await prisma.user.deleteMany({
        where: { email: { in: [adminEmail, userEmail, parallelUserEmail] } },
      });
    }
    await app?.close();
  });

  function post(path: string, body: unknown, token?: string, ip = '203.0.113.143') {
    const req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  }

  function get(path: string, input?: unknown, token?: string, ip = '203.0.113.144') {
    const req = request(app.getHttpServer()).get(`/trpc/${path}`).set('X-Forwarded-For', ip);
    if (input !== undefined) req.query({ input: JSON.stringify(input) });
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  }

  async function registerUser(email: string, username: string, ip: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', ip)
      .send({ email, username, password: 'parallel-password' });
    expect(response.status).toBe(200);
    const token = resultData(response.body).token;
    if (typeof token !== 'string') throw new Error('expected token');
    return token;
  }

  async function registerAdmin(email: string, username: string, ip: string): Promise<string> {
    const token = await registerUser(email, username, ip);
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    return token;
  }

  async function createCard(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await post(
      'admin.cards.create',
      { rarity: 'common', attributes: {}, ...input },
      adminToken,
    );
    expect(response.status).toBe(200);
    return resultData(response.body);
  }

  function listedSlugs(body: unknown): string[] {
    return rowsOf(body, 'items').map((row) => text(row, 'slug'));
  }

  it('hides parallels until includeParallels and reports an unfiltered parallelCount', async () => {
    const hidden = await get('cards.listBySeries', { seriesSlug });
    expect(hidden.status).toBe(200);
    const hiddenBody = resultData(hidden.body);
    expect(whole(hiddenBody, 'total')).toBe(2);
    expect(whole(hiddenBody, 'seriesTotal')).toBe(2);
    expect(whole(hiddenBody, 'parallelCount')).toBe(5);
    expect(listedSlugs(hidden.body)).toEqual([slug('base'), slug('loose')]);
    const baseItem = rowsOf(hidden.body, 'items').find((row) => row.slug === slug('base'));
    if (!baseItem) throw new Error('expected base');
    expect(baseItem.isParallel).toBe(false);
    expect(nullableText(baseItem, 'parallelName')).toBeNull();
    expect(nullableNumber(baseItem, 'printRun')).toBeNull();

    const shown = await get('cards.listBySeries', { seriesSlug, includeParallels: true });
    expect(shown.status).toBe(200);
    expect(listedSlugs(shown.body)).toEqual([
      slug('early'),
      slug('base'),
      slug('plain'),
      slug('alpha'),
      slug('gold'),
      slug('low'),
      slug('loose'),
    ]);
    expect(whole(resultData(shown.body), 'total')).toBe(7);
    expect(whole(resultData(shown.body), 'seriesTotal')).toBe(2);
    expect(whole(resultData(shown.body), 'parallelCount')).toBe(5);

    const explicit = await get('cards.listBySeries', { seriesSlug, includeParallels: false });
    expect(listedSlugs(explicit.body)).toEqual(listedSlugs(hidden.body));

    const filtered = await get('cards.listBySeries', { seriesSlug, q: '早号' });
    expect(whole(resultData(filtered.body), 'total')).toBe(0);
    expect(whole(resultData(filtered.body), 'seriesTotal')).toBe(2);
    expect(whole(resultData(filtered.body), 'parallelCount')).toBe(5);

    const byParallelName = await get('cards.listBySeries', {
      seriesSlug,
      q: 'beta',
      includeParallels: true,
    });
    expect(whole(resultData(byParallelName.body), 'total')).toBe(0);

    const legacy = await get('series.bySlug', { slug: seriesSlug });
    expect(legacy.status).toBe(200);
    expect(rowsOf(legacy.body, 'cards')).toHaveLength(7);
  });

  it('returns the parallel group from bySlug and the parallel fields from search', async () => {
    const base = await get('cards.bySlug', { slug: slug('base') });
    expect(base.status).toBe(200);
    const baseBody = resultData(base.body);
    expect(baseBody.base).toBeNull();
    expect(nullableText(baseBody, 'parallelName')).toBeNull();
    expect(rowsOf(base.body, 'variants').map((row) => text(row, 'slug'))).toEqual([
      slug('base'),
      slug('plain'),
      slug('early'),
      slug('alpha'),
      slug('gold'),
      slug('low'),
    ]);
    expect(rowsOf(base.body, 'variants').find((row) => row.slug === slug('base'))?.isCurrent).toBe(
      true,
    );

    const gold = await get('cards.bySlug', { slug: slug('gold') });
    expect(gold.status).toBe(200);
    const goldBody = resultData(gold.body);
    expect(goldBody.base).toEqual({ slug: slug('base'), name: '基础' });
    expect(nullableText(goldBody, 'parallelName')).toBe('beta');
    expect(nullableNumber(goldBody, 'printRun')).toBe(10);
    const current = rowsOf(gold.body, 'variants').find((row) => row.slug === slug('gold'));
    if (!current) throw new Error('expected current variant');
    expect(current.isCurrent).toBe(true);
    expect(rowsOf(gold.body, 'variants').filter((row) => row.isCurrent === true)).toHaveLength(1);

    const loose = await get('cards.bySlug', { slug: slug('loose') });
    expect(loose.status).toBe(200);
    const looseVariants = rowsOf(loose.body, 'variants');
    expect(looseVariants).toHaveLength(1);
    expect(looseVariants[0]?.isCurrent).toBe(true);
    expect(resultData(loose.body).base).toBeNull();

    const searched = await get('cards.search', { q: '十限甲', seriesSlug, limit: 5 });
    expect(searched.status).toBe(200);
    const found = rowsOf(searched.body, 'results').find((row) => row.slug === slug('alpha'));
    if (!found) throw new Error('expected search hit');
    expect(nullableText(found, 'parallelName')).toBe('alpha');
    expect(nullableNumber(found, 'printRun')).toBe(10);

    const global = await get('search.global', { q: '十限甲', limit: 5 });
    expect(global.status).toBe(200);
    const globalHit = rowsOf(global.body, 'cards').find((row) => row.slug === slug('alpha'));
    if (!globalHit) throw new Error('expected global hit');
    expect(nullableText(globalHit, 'parallelName')).toBe('alpha');
    expect(nullableNumber(globalHit, 'printRun')).toBe(10);

    const adminBase = await get('admin.cards.get', { slug: slug('base') }, adminToken);
    expect(adminBase.status).toBe(200);
    expect(whole(resultData(adminBase.body), 'parallelChildrenCount')).toBe(5);
    expect(nullableText(resultData(adminBase.body), 'parallelOfSlug')).toBeNull();

    const foil = await createCard({
      slug: slug('foil'),
      name: '素卡',
      seriesSlug,
      cardNumber: '40',
      parallelOfSlug: slug('base'),
      parallelName: '金箔',
    });
    expect(text(foil, 'slug')).toBe(slug('foil'));

    const byFoilName = await get('search.global', { q: '金箔', limit: 5 });
    expect(byFoilName.status).toBe(200);
    const foilHit = rowsOf(byFoilName.body, 'cards').find((row) => row.slug === slug('foil'));
    if (!foilHit) throw new Error('expected parallel name hit');
    expect(text(foilHit, 'name')).toBe('素卡');
    expect(nullableText(foilHit, 'parallelName')).toBe('金箔');

    const byFoilSearch = await get('cards.search', { q: '金箔', seriesSlug, limit: 5 });
    expect(byFoilSearch.status).toBe(200);
    const foilSearchHit = rowsOf(byFoilSearch.body, 'results').find(
      (row) => row.slug === slug('foil'),
    );
    if (!foilSearchHit) throw new Error('expected cards.search parallel name hit');
    expect(nullableText(foilSearchHit, 'parallelName')).toBe('金箔');

    const seriesSkipsParallelName = await get('cards.listBySeries', {
      seriesSlug,
      q: '金箔',
      includeParallels: true,
    });
    expect(seriesSkipsParallelName.status).toBe(200);
    expect(whole(resultData(seriesSkipsParallelName.body), 'total')).toBe(0);
  });

  it('counts only base cards in collection progress', async () => {
    const ownedBase = await post(
      'collection.upsert',
      { cardSlug: slug('base'), ownedCount: 1, wanted: false },
      userToken,
      '203.0.113.145',
    );
    expect(ownedBase.status).toBe(200);
    const ownedParallel = await post(
      'collection.upsert',
      { cardSlug: slug('gold'), ownedCount: 3, wanted: false },
      userToken,
      '203.0.113.145',
    );
    expect(ownedParallel.status).toBe(200);
    const progress = await get('collection.progress', undefined, userToken, '203.0.113.145');
    expect(progress.status).toBe(200);
    const row = rowsOf(progress.body, 'items').find((item) => item.seriesSlug === seriesSlug);
    if (!row) throw new Error('expected progress');
    expect(whole(row, 'owned')).toBe(1);
    expect(whole(row, 'total')).toBe(2);

    const onlyParallel = await post(
      'collection.upsert',
      { cardSlug: slug('early'), ownedCount: 1, wanted: false },
      parallelUserToken,
      '203.0.113.146',
    );
    expect(onlyParallel.status).toBe(200);
    const parallelProgress = await get(
      'collection.progress',
      undefined,
      parallelUserToken,
      '203.0.113.146',
    );
    const parallelRow = rowsOf(parallelProgress.body, 'items').find(
      (item) => item.seriesSlug === seriesSlug,
    );
    if (!parallelRow) throw new Error('expected parallel-only progress');
    expect(whole(parallelRow, 'owned')).toBe(0);
    expect(whole(parallelRow, 'total')).toBe(2);
  });

  it('keeps an omitted parallel on update and clears the link without erasing the name', async () => {
    const created = await createCard({
      slug: slug('keep'),
      name: '保留',
      seriesSlug,
      parallelOfSlug: slug('loose'),
      parallelName: '银折',
      printRun: 4,
    });
    expect(nullableText(created, 'parallelOfSlug')).toBe(slug('loose'));
    expect(whole(created, 'parallelChildrenCount')).toBe(0);

    const renamed = await post(
      'admin.cards.update',
      {
        slug: slug('keep'),
        name: '保留改名',
        rarity: 'common',
        attributes: {},
        seriesSlug,
      },
      adminToken,
    );
    expect(renamed.status).toBe(200);
    expect(nullableText(resultData(renamed.body), 'parallelOfSlug')).toBe(slug('loose'));
    expect(nullableText(resultData(renamed.body), 'parallelName')).toBe('银折');
    expect(nullableNumber(resultData(renamed.body), 'printRun')).toBe(4);

    const cleared = await post(
      'admin.cards.update',
      {
        slug: slug('keep'),
        name: '保留改名',
        rarity: 'common',
        attributes: {},
        seriesSlug,
        parallelOfSlug: '',
        printRun: null,
      },
      adminToken,
    );
    expect(cleared.status).toBe(200);
    expect(nullableText(resultData(cleared.body), 'parallelOfSlug')).toBeNull();
    expect(nullableText(resultData(cleared.body), 'parallelName')).toBe('银折');
    expect(nullableNumber(resultData(cleared.body), 'printRun')).toBeNull();
  });

  it('rejects parallel links with field codes and does not leak parser text', async () => {
    const cases: Array<{ body: Record<string, unknown>; field: string; code: string }> = [
      {
        body: {
          slug: slug('cross'),
          name: '跨系列',
          seriesSlug,
          parallelOfSlug: slug('other-base'),
          parallelName: '金箔',
        },
        field: 'parallelOfSlug',
        code: 'parallel_cross_series',
      },
      {
        body: {
          slug: slug('chain'),
          name: '再挂',
          seriesSlug,
          parallelOfSlug: slug('gold'),
          parallelName: '金箔',
        },
        field: 'parallelOfSlug',
        code: 'parallel_chain',
      },
      {
        body: {
          slug: slug('self'),
          name: '自己',
          seriesSlug,
          parallelOfSlug: slug('self'),
          parallelName: '金箔',
        },
        field: 'parallelOfSlug',
        code: 'parallel_self',
      },
      {
        body: {
          slug: slug('missing'),
          name: '缺失',
          seriesSlug,
          parallelOfSlug: slug('no-such-base'),
          parallelName: '金箔',
        },
        field: 'parallelOfSlug',
        code: 'parallel_base_missing',
      },
      {
        body: {
          slug: slug('noname'),
          name: '没名',
          seriesSlug,
          parallelOfSlug: slug('loose'),
          parallelName: '   ',
        },
        field: 'parallelName',
        code: 'parallel_name_required',
      },
      {
        body: {
          slug: slug('long'),
          name: '太长',
          seriesSlug,
          parallelOfSlug: slug('loose'),
          parallelName: '卡'.repeat(41),
        },
        field: 'parallelName',
        code: 'too_big',
      },
      {
        body: { slug: slug('zero'), name: '零', seriesSlug, printRun: 0 },
        field: 'printRun',
        code: 'too_small',
      },
      {
        body: { slug: slug('fraction'), name: '小数', seriesSlug, printRun: 1.5 },
        field: 'printRun',
        code: 'invalid_type',
      },
      {
        body: { slug: slug('text'), name: '文本', seriesSlug, printRun: '9' },
        field: 'printRun',
        code: 'invalid_type',
      },
    ];

    for (const sample of cases) {
      const response = await post(
        'admin.cards.create',
        { rarity: 'common', attributes: {}, ...sample.body },
        adminToken,
      );
      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe(VALIDATION);
      expect(fieldErrors(response.body, sample.field)).toEqual([sample.code]);
      assertNoInternalText(response.body);
    }

    const hasChildren = await post(
      'admin.cards.update',
      {
        slug: slug('base'),
        name: '基础',
        rarity: 'common',
        attributes: {},
        seriesSlug,
        parallelOfSlug: slug('loose'),
        parallelName: '不该成功',
      },
      adminToken,
    );
    expect(hasChildren.status).toBe(400);
    expect(hasChildren.body.error.message).toBe(VALIDATION);
    expect(fieldErrors(hasChildren.body, 'parallelOfSlug')).toEqual(['parallel_has_children']);
    assertNoInternalText(hasChildren.body);
    const stillBase = await get('admin.cards.get', { slug: slug('base') }, adminToken);
    expect(nullableText(resultData(stillBase.body), 'parallelOfSlug')).toBeNull();

    const badFlag = await get('cards.listBySeries', { seriesSlug, includeParallels: 'true' });
    expect(badFlag.status).toBe(400);
    expect(badFlag.body.error.message).toBe(VALIDATION);
    expect(fieldErrors(badFlag.body, 'includeParallels')).toEqual(['invalid_type']);
    assertNoInternalText(badFlag.body);

    const tooLarge = await request(app.getHttpServer())
      .post('/trpc/admin.cards.create')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.147')
      .send(Buffer.alloc(100 * 1024 + 1, 0x78));
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data.httpStatus).toBe(413);
    assertNoInternalText(tooLarge.body);

    const badJson = await request(app.getHttpServer())
      .post('/trpc/admin.cards.create')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.148')
      .send('{"slug":"PARSER_LEAK_MARKER"');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.message).toBe(PARSE_ERROR);
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
    expect(JSON.stringify(badJson.body)).not.toContain('PARSER_LEAK_MARKER');
    assertNoInternalText(badJson.body);
  });

  it('turns parallels into base cards when the base is deleted or moves series', async () => {
    const parent = await createCard({
      slug: slug('parent'),
      name: '将被删',
      seriesSlug,
      cardNumber: '20',
    });
    await createCard({
      slug: slug('child'),
      name: '孤儿',
      seriesSlug,
      cardNumber: '20',
      parallelOfSlug: slug('parent'),
      parallelName: '留名',
      printRun: 8,
    });
    const removed = await post(
      'admin.cards.delete',
      { slug: slug('parent') },
      adminToken,
      '203.0.113.149',
    );
    expect(removed.status).toBe(200);
    const child = await prisma.card.findUnique({ where: { slug: slug('child') } });
    expect(child?.parallelOfId).toBeNull();
    expect(child?.parallelName).toBe('留名');
    const childDetail = await get('cards.bySlug', { slug: slug('child') });
    expect(childDetail.status).toBe(200);
    expect(resultData(childDetail.body).base).toBeNull();
    expect(nullableText(resultData(childDetail.body), 'parallelName')).toBe('留名');
    const hidden = await get('cards.listBySeries', { seriesSlug, q: '孤儿' });
    expect(listedSlugs(hidden.body)).toEqual([slug('child')]);
    expect(text(resultData(removed.body), 'slug')).toBe(slug('parent'));
    expect(text(parent, 'slug')).toBe(slug('parent'));

    const mover = await createCard({
      slug: slug('mover'),
      name: '搬走',
      seriesSlug,
      cardNumber: '21',
    });
    await createCard({
      slug: slug('left'),
      name: '留下',
      seriesSlug,
      cardNumber: '21',
      parallelOfSlug: slug('mover'),
      parallelName: '还在',
    });
    const other = await prisma.series.findUnique({ where: { slug: otherSlug } });
    if (!other) throw new Error('expected other series');
    await prisma.card.update({ where: { id: text(mover, 'id') }, data: { seriesId: other.id } });
    const left = await prisma.card.findUnique({ where: { slug: slug('left') } });
    expect(left?.parallelOfId).toBeNull();
    expect(left?.parallelName).toBe('还在');
    expect(left?.seriesId).not.toBe(other.id);

    const movedParallel = await createCard({
      slug: slug('moved-parallel'),
      name: '跟着改系列',
      seriesSlug,
      parallelOfSlug: slug('loose'),
      parallelName: '原名',
    });
    const moved = await post(
      'admin.cards.update',
      {
        slug: slug('moved-parallel'),
        name: '跟着改系列',
        rarity: 'common',
        attributes: {},
        seriesSlug: otherSlug,
      },
      adminToken,
    );
    expect(moved.status).toBe(200);
    expect(nullableText(resultData(moved.body), 'parallelOfSlug')).toBeNull();
    expect(nullableText(resultData(moved.body), 'parallelName')).toBe('原名');
    expect(text(resultData(moved.body), 'seriesSlug')).toBe(otherSlug);
    expect(text(movedParallel, 'name')).toBe('跟着改系列');
  });

  it('keeps a parallel link only when one update moves both cards into the same series', async () => {
    const seriesA = await prisma.series.create({
      data: { slug: slug('move-a'), title: '甲系列' },
    });
    const seriesB = await prisma.series.create({
      data: { slug: slug('move-b'), title: '乙系列' },
    });
    const togetherBase = await prisma.card.create({
      data: { slug: slug('tog-base'), name: '一起基础', seriesId: seriesA.id },
    });
    const togetherChild = await prisma.card.create({
      data: {
        slug: slug('tog-child'),
        name: '一起平行',
        seriesId: seriesA.id,
        parallelOfId: togetherBase.id,
        parallelName: '金箔',
      },
    });
    const baseOnly = await prisma.card.create({
      data: { slug: slug('base-only'), name: '只搬基础', seriesId: seriesA.id },
    });
    const childStays = await prisma.card.create({
      data: {
        slug: slug('child-stays'),
        name: '留下的平行',
        seriesId: seriesA.id,
        parallelOfId: baseOnly.id,
        parallelName: '银折',
      },
    });
    const baseStays = await prisma.card.create({
      data: { slug: slug('base-stays'), name: '不动的基础', seriesId: seriesA.id },
    });
    const childOnly = await prisma.card.create({
      data: {
        slug: slug('child-only'),
        name: '只搬平行',
        seriesId: seriesA.id,
        parallelOfId: baseStays.id,
        parallelName: '原名',
      },
    });

    await prisma.$executeRaw`
      UPDATE "cards"
      SET "seriesId" = ${seriesB.id}
      WHERE "id" = ${togetherChild.id} OR "id" = ${togetherBase.id}
    `;
    const kept = await prisma.card.findUnique({ where: { id: togetherChild.id } });
    const keptBase = await prisma.card.findUnique({ where: { id: togetherBase.id } });
    expect(keptBase?.seriesId).toBe(seriesB.id);
    expect(kept?.seriesId).toBe(seriesB.id);
    expect(kept?.parallelOfId).toBe(togetherBase.id);
    expect(kept?.parallelName).toBe('金箔');

    await prisma.$executeRaw`
      UPDATE "cards" SET "seriesId" = ${seriesB.id} WHERE "id" = ${baseOnly.id}
    `;
    const leftBehind = await prisma.card.findUnique({ where: { id: childStays.id } });
    expect(leftBehind?.seriesId).toBe(seriesA.id);
    expect(leftBehind?.parallelOfId).toBeNull();
    expect(leftBehind?.parallelName).toBe('银折');

    await prisma.$executeRaw`
      UPDATE "cards" SET "seriesId" = ${seriesB.id} WHERE "id" = ${childOnly.id}
    `;
    const movedChild = await prisma.card.findUnique({ where: { id: childOnly.id } });
    const unmovedBase = await prisma.card.findUnique({ where: { id: baseStays.id } });
    expect(unmovedBase?.seriesId).toBe(seriesA.id);
    expect(movedChild?.seriesId).toBe(seriesB.id);
    expect(movedChild?.parallelOfId).toBeNull();
    expect(movedChild?.parallelName).toBe('原名');

    await prisma.series.deleteMany({ where: { id: { in: [seriesA.id, seriesB.id] } } });
  });
});
