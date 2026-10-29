import type { INestApplication } from '@nestjs/common';
import { APP_ERROR_CODES } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';

const FIXED_TRPC_BODY = {
  error: {
    message: '请求无法解析，请重试',
    code: -32600,
    data: {
      code: 'BAD_REQUEST',
      httpStatus: 400,
      appCode: APP_ERROR_CODES.PARSE_ERROR,
    },
  },
};

describe('malformed JSON through the Nest bootstrap', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const cases = [
    {
      path: '/trpc/comments.create',
      procedure: 'comments.create',
      kind: 'truncated',
      body: '{"content":"TRUNC_MARKER_comments',
    },
    {
      path: '/trpc/comments.create',
      procedure: 'comments.create',
      kind: 'illegal',
      body: '{"content":"ILLEGAL_MARKER_comments", "x":}}',
    },
    {
      path: '/trpc/admin.catalog.import',
      procedure: 'admin.catalog.import',
      kind: 'truncated',
      body: '{"rows":["IMPORT_TRUNC_MARKER"',
    },
    {
      path: '/trpc/admin.catalog.import',
      procedure: 'admin.catalog.import',
      kind: 'illegal',
      body: '{"rows":[IMPORT_ILLEGAL_MARKER]}',
    },
  ];

  it.each(cases)(
    '$path rejects a $kind body with fixed copy',
    async ({ path, procedure, body }) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .set('Content-Type', 'application/json')
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          ...FIXED_TRPC_BODY.error,
          data: {
            ...FIXED_TRPC_BODY.error.data,
            path: procedure,
          },
        },
      });
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('Unexpected token');
      expect(serialized).not.toContain('is not valid JSON');
      expect(serialized).not.toContain('MARKER');
      expect(serialized).not.toContain('Bad Request');
    },
  );

  it('returns PARSE_ERROR for bad JSON and keeps an oversize body at 413', async () => {
    const badJson = await request(app.getHttpServer())
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .send('{"content":"PARSER_LEAK_MARKER"');

    expect(badJson.status).toBe(400);
    expect(badJson.body.error.message).toBe('请求无法解析，请重试');
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
    const badSerialized = JSON.stringify(badJson.body);
    expect(badSerialized).not.toContain('PARSER_LEAK_MARKER');
    expect(badSerialized).not.toContain('Unexpected token');
    expect(badSerialized).not.toContain('is not valid JSON');
    expect(badSerialized).not.toContain('SyntaxError');

    const tooLarge = await request(app.getHttpServer())
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .send(Buffer.alloc(100 * 1024 + 1, 0x78));

    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.message).toBe('内容太大，请精简后重试');
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data.appCode).toBe(APP_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(tooLarge.body.error.data.httpStatus).toBe(413);
    const largeSerialized = JSON.stringify(tooLarge.body);
    expect(largeSerialized).not.toContain('entity.too.large');
    expect(largeSerialized).not.toContain('request entity too large');
  });

  it('returns fixed JSON for a malformed body outside /trpc', async () => {
    const response = await request(app.getHttpServer())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"HEALTH_LEAK_MARKER":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      statusCode: 400,
      message: '请求无法解析，请重试',
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('HEALTH_LEAK_MARKER');
    expect(serialized).not.toContain('Unexpected token');
    expect(serialized).not.toContain('is not valid JSON');
    expect(serialized).not.toContain('Unterminated');
  });
});
