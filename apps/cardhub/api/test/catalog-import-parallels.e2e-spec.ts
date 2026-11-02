import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_ERROR_CODES, CATALOG_IMPORT_MAX_BYTES, appErrorMessage } from '@repo/shared';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const VALIDATION = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.result)) throw new Error('expected tRPC result');
  return body.result.data;
}

function rowsOf(body: unknown): Array<Record<string, unknown>> {
  const data = resultData(body);
  if (!Array.isArray(data)) throw new Error('expected rows');
  return data.filter(isRecord);
}

function assertNoInternalText(body: unknown): void {
  let serialized = JSON.stringify(body);
  if (isRecord(body) && isRecord(body.error) && isRecord(body.error.data)) {
    const data = { ...body.error.data };
    delete data.stack;
    serialized = JSON.stringify({ ...body, error: { ...body.error, data } });
  }
  expect(serialized).not.toContain('Prisma');
  expect(serialized).not.toContain('invocation');
  expect(serialized).not.toContain('Unexpected token');
  expect(serialized).not.toContain('is not valid JSON');
  expect(serialized).not.toContain('node_modules');
  expect(serialized).not.toContain('SyntaxError');
}

describe('catalog import parallels', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const adminEmail = `imp-admin-${suffix}@cardhub.test`;
  let adminToken = '';
  const slug = (name: string) => `${name}-${suffix}`;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.210')
      .send({
        email: adminEmail,
        username: `iadm${suffix}`.slice(0, 24),
        password: 'import-password',
      });
    expect(registered.status).toBe(200);
    const token = resultData(registered.body);
    if (!isRecord(token) || typeof token.token !== 'string') throw new Error('expected token');
    adminToken = token.token;
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.card.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.series.deleteMany({ where: { slug: { contains: suffix } } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
    await app?.close();
  });

  function post(path: string, body: unknown) {
    return request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.211')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function cardRow(name: string, extra: Record<string, unknown> = {}) {
    return {
      slug: slug(name),
      name,
      rarity: 'common',
      attributes: {},
      ...extra,
    };
  }

  it('rejects bad JSON with 400 and an oversize body with 413 without leaking parser text', async () => {
    const badJson = await request(app.getHttpServer())
      .post('/trpc/admin.catalog.import')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.212')
      .send('{"dryRun":true,"data":[IMPORT_BAD_JSON');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
    expect(JSON.stringify(badJson.body)).not.toContain('IMPORT_BAD_JSON');
    assertNoInternalText(badJson.body);

    const tooLarge = await post('admin.catalog.import', {
      dryRun: true,
      data: [{ slug: slug('big'), title: '太大', blob: 'x'.repeat(CATALOG_IMPORT_MAX_BYTES) }],
    });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data.httpStatus).toBe(413);
    assertNoInternalText(tooLarge.body);
  });

  it('does not swallow a real transaction failure on preview', async () => {
    const timeout = Object.assign(new Error('Transaction already closed: P2028 timeout'), {
      code: 'P2028',
    });
    const spy = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(timeout);
    try {
      const preview = await post('admin.catalog.import', {
        dryRun: true,
        data: [
          {
            slug: slug('tx-fail'),
            title: '事务失败',
            cards: [
              cardRow('tx-card'),
              cardRow('tx-foil', { parallelOf: slug('tx-card'), parallelName: '闪' }),
            ],
          },
        ],
      });
      expect(spy).toHaveBeenCalled();
      expect(preview.status).toBe(500);
      expect(preview.body.error.data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(preview.body.result).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.series.findUnique({ where: { slug: slug('tx-fail') } })).toBeNull();
  });

  it('returns print_run_min and too_big on the import row', async () => {
    const preview = await post('admin.catalog.import', {
      dryRun: true,
      data: [
        {
          slug: slug('run-series'),
          title: '限量系列',
          cards: [cardRow('zero', { printRun: 0 }), cardRow('huge', { printRun: 2_147_483_648 })],
        },
      ],
    });
    expect(preview.status).toBe(200);
    const rows = rowsOf(preview.body);
    const zero = rows.find((row) => isRecord(row.row) && row.row.slug === slug('zero'));
    const huge = rows.find((row) => isRecord(row.row) && row.row.slug === slug('huge'));
    expect(zero?.status).toBe('error');
    expect(huge?.status).toBe('error');
    expect(zero?.errors).toEqual([
      expect.objectContaining({ path: 'series[0].cards[0].printRun', code: 'print_run_min' }),
    ]);
    expect(huge?.errors).toEqual([
      expect.objectContaining({ path: 'series[0].cards[1].printRun', code: 'too_big' }),
    ]);
    assertNoInternalText(preview.body);

    const executed = await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('run-series'),
          title: '限量系列',
          cards: [cardRow('zero', { printRun: 0 })],
        },
      ],
    });
    expect(executed.status).toBe(400);
    expect(executed.body.error.message).toBe('导入数据校验失败');
    const stored = executed.body.error.data.adminCatalogError.rows as Array<{
      errors: Array<{ code: string }>;
    }>;
    expect(stored.some((row) => row.errors.some((error) => error.code === 'print_run_min'))).toBe(
      true,
    );
    assertNoInternalText(executed.body);
    expect(await prisma.card.findUnique({ where: { slug: slug('zero') } })).toBeNull();
  });

  it('stores a null parallel name when the imported card has no base', async () => {
    const imported = await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('plain-series'),
          title: '普通系列',
          cards: [cardRow('plain', { parallelName: '金箔' })],
        },
      ],
    });
    expect(imported.status).toBe(200);
    const row = await prisma.card.findUnique({ where: { slug: slug('plain') } });
    expect(row?.parallelOfId).toBeNull();
    expect(row?.parallelName).toBeNull();
  });

  it('imports a same-series parallel and rejects a cross-series base', async () => {
    await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('home'),
          title: '本系列',
          cards: [cardRow('base')],
        },
      ],
    });
    const linked = await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('home'),
          title: '本系列',
          cards: [
            cardRow('foil', {
              parallelOf: slug('base'),
              parallelName: '金箔',
              printRun: 7,
            }),
          ],
        },
      ],
    });
    expect(linked.status).toBe(200);
    const foil = await prisma.card.findUnique({ where: { slug: slug('foil') } });
    const base = await prisma.card.findUnique({ where: { slug: slug('base') } });
    expect(foil?.parallelOfId).toBe(base?.id);
    expect(foil?.parallelName).toBe('金箔');
    expect(foil?.printRun).toBe(7);

    const crossed = await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('away'),
          title: '别的系列',
          cards: [
            cardRow('stray', {
              parallelOf: slug('base'),
              parallelName: '银折',
            }),
          ],
        },
      ],
    });
    expect(crossed.status).toBe(400);
    expect(crossed.body.error.message).toBe('导入数据校验失败');
    expect(crossed.body.error.data.appCode).toBe(APP_ERROR_CODES.BAD_REQUEST);
    const rows = crossed.body.error.data.adminCatalogError.rows as Array<{
      errors: Array<{ code: string; path: string }>;
    }>;
    expect(
      rows.some((row) =>
        row.errors.some(
          (error) => error.code === 'parallel_cross_series' && error.path.endsWith('.parallelOf'),
        ),
      ),
    ).toBe(true);
    assertNoInternalText(crossed.body);
    expect(VALIDATION.length).toBeGreaterThan(0);
    expect(await prisma.card.findUnique({ where: { slug: slug('stray') } })).toBeNull();
  });

  it('clears a parallel left behind when its base moves series in the same import', async () => {
    await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('origin'),
          title: '原系列',
          cards: [
            cardRow('mover'),
            cardRow('child', { parallelOf: slug('mover'), parallelName: '留名', printRun: 4 }),
          ],
        },
      ],
    });
    const moved = await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('destination'),
          title: '新系列',
          cards: [cardRow('mover')],
        },
      ],
    });
    expect(moved.status).toBe(200);
    const child = await prisma.card.findUnique({ where: { slug: slug('child') } });
    const origin = await prisma.series.findUnique({ where: { slug: slug('origin') } });
    expect(child?.seriesId).toBe(origin?.id);
    expect(child?.parallelOfId).toBeNull();
    expect(child?.parallelName).toBeNull();
    expect(child?.printRun).toBe(4);
  });

  it('reports every parallel field error on preview and keeps an unchanged card out of created', async () => {
    await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('home'),
          title: '本系列',
          cards: [cardRow('kept', { name: '留下' }), cardRow('base', { name: '基础' })],
        },
      ],
    });
    await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('home'),
          title: '本系列',
          cards: [
            cardRow('linked', {
              parallelOf: slug('base'),
              parallelName: '已挂',
            }),
          ],
        },
      ],
    });

    const preview = await post('admin.catalog.import', {
      dryRun: true,
      data: [
        {
          slug: slug('home'),
          title: '本系列',
          cards: [
            cardRow('kept', { name: '留下' }),
            cardRow('chain', { parallelOf: slug('linked'), parallelName: '挂链' }),
            cardRow('self', { parallelOf: slug('self'), parallelName: '自己' }),
            cardRow('missing', { parallelOf: slug('no-such'), parallelName: '缺失' }),
            cardRow('noname', { parallelOf: slug('base'), parallelName: '   ' }),
            cardRow('zero', { printRun: 0, parallelOf: slug('base'), parallelName: '零' }),
            cardRow('huge', { printRun: 2_147_483_648 }),
            cardRow('fraction', { printRun: 1.5 }),
            cardRow('long-name', { parallelOf: slug('base'), parallelName: '名'.repeat(41) }),
            cardRow('multi', {
              printRun: 0,
              parallelName: '名'.repeat(41),
              parallelOf: slug('no-such'),
            }),
            cardRow('fresh-base', { name: '文件内基础卡' }),
            cardRow('fresh-foil', { parallelOf: slug('fresh-base'), parallelName: '文件内' }),
            cardRow('base', {
              name: '基础',
              parallelOf: slug('kept'),
              parallelName: '再挂',
            }),
          ],
        },
        {
          slug: slug('away'),
          title: '别的系列',
          cards: [cardRow('cross', { parallelOf: slug('base'), parallelName: '跨系列' })],
        },
      ],
    });
    expect(preview.status).toBe(200);
    const codes = (name: string) => {
      const row = rowsOf(preview.body).find(
        (item) => isRecord(item.row) && item.row.slug === slug(name),
      );
      const errors = row?.errors;
      if (!Array.isArray(errors)) return [];
      return errors.filter(isRecord).map((error) => error.code);
    };
    const kept = rowsOf(preview.body).find(
      (item) => isRecord(item.row) && item.row.slug === slug('kept'),
    );
    expect(kept?.status).toBe('unchanged');
    expect(codes('cross')).toEqual(['parallel_cross_series']);
    expect(codes('chain')).toEqual(['parallel_chain']);
    expect(codes('self')).toEqual(['parallel_self']);
    expect(codes('base')).toEqual(['parallel_has_children']);
    expect(codes('missing')).toEqual(['parallel_base_missing']);
    expect(codes('noname')).toEqual(['parallel_name_required']);
    expect(codes('zero')).toEqual(['print_run_min']);
    expect(codes('huge')).toEqual(['too_big']);
    expect(codes('fraction')).toEqual(['invalid_type']);
    expect(codes('long-name')).toEqual(['too_big']);
    const multi = rowsOf(preview.body).find(
      (item) => isRecord(item.row) && item.row.slug === slug('multi'),
    );
    expect(multi?.errors).toEqual([
      { path: 'series[0].cards[9].parallelOf', code: 'parallel_base_missing' },
      { path: 'series[0].cards[9].parallelName', code: 'too_big' },
      { path: 'series[0].cards[9].printRun', code: 'print_run_min' },
    ]);
    for (const name of ['fresh-base', 'fresh-foil']) {
      const row = rowsOf(preview.body).find(
        (item) => isRecord(item.row) && item.row.slug === slug(name),
      );
      expect(row?.status).toBe('created');
      expect(row?.errors).toEqual([]);
    }
    expect(await prisma.card.findUnique({ where: { slug: slug('fresh-base') } })).toBeNull();
    expect(await prisma.card.findUnique({ where: { slug: slug('cross') } })).toBeNull();

    const failed = await post('admin.catalog.import', {
      dryRun: false,
      data: [
        {
          slug: slug('home'),
          title: '本系列',
          cards: [cardRow('kept', { name: '留下' })],
        },
        {
          slug: slug('away'),
          title: '别的系列',
          cards: [cardRow('stray', { parallelOf: slug('base'), parallelName: '银折' })],
        },
      ],
    });
    expect(failed.status).toBe(400);
    expect(failed.body.error.message).toBe('导入数据校验失败');
    const failedRows = failed.body.error.data.adminCatalogError.rows as Array<{
      status: string;
      row: { slug: string | null };
      errors: Array<{ code: string; path: string }>;
    }>;
    expect(failedRows.find((row) => row.row.slug === slug('kept'))?.status).toBe('unchanged');
    expect(
      failedRows
        .find((row) => row.row.slug === slug('stray'))
        ?.errors.some((error) => error.code === 'parallel_cross_series'),
    ).toBe(true);
    assertNoInternalText(failed.body);
    expect(await prisma.card.findUnique({ where: { slug: slug('stray') } })).toBeNull();
    expect((await prisma.card.findUnique({ where: { slug: slug('kept') } }))?.name).toBe('留下');
  });
});
