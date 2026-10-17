import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';

const FIXED_TRPC_BODY = {
  error: {
    message: '请求格式有误',
    code: -32600,
    data: {
      code: 'BAD_REQUEST',
      httpStatus: 400,
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

  it('returns fixed JSON for a malformed body outside /trpc', async () => {
    const response = await request(app.getHttpServer())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"HEALTH_LEAK_MARKER":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      statusCode: 400,
      message: '请求格式有误',
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('HEALTH_LEAK_MARKER');
    expect(serialized).not.toContain('Unexpected token');
    expect(serialized).not.toContain('is not valid JSON');
    expect(serialized).not.toContain('Unterminated');
  });
});
