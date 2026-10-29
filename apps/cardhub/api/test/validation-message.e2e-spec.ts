import type { INestApplication } from '@nestjs/common';
import { APP_ERROR_CODES, appErrorMessage } from '@repo/shared';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';

const CH114 = appErrorMessage('zh-CN', APP_ERROR_CODES.VALIDATION);

describe('BAD_REQUEST copy (CH-114)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 400 with the CH-114 sentence and field errors for an invalid input', async () => {
    const response = await request(app.getHttpServer())
      .get('/trpc/search.global')
      .query({ input: JSON.stringify({ q: '极光', seriesLimit: 99 }) });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe(CH114);
    expect(response.body.error.message).not.toMatch(
      /\[|too_big|Too big|ZodError|Unexpected token|is not valid JSON|Invalid input/,
    );
    expect(response.body.error.data).toEqual(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        httpStatus: 400,
        appCode: APP_ERROR_CODES.VALIDATION,
        path: 'search.global',
      }),
    );
    expect(response.body.error.data.zodError.fieldErrors.seriesLimit).toEqual(['too_big']);
    expect(response.body.error.data.zodError.issues).toEqual([
      expect.objectContaining({
        path: ['seriesLimit'],
        code: 'too_big',
        message: 'too_big',
      }),
    ]);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('Too big');
    expect(serialized).not.toContain('Invalid input');
    expect(serialized).not.toContain('ZodError');
    expect(serialized).not.toContain('"origin"');
    expect(serialized).not.toContain('Unexpected token');
    expect(serialized).not.toContain('is not valid JSON');
  });

  it('returns 413 for an oversize body and 400 for bad JSON without parser text', async () => {
    const tooLarge = await request(app.getHttpServer())
      .post('/trpc/search.global')
      .set('Content-Type', 'application/json')
      .send(Buffer.alloc(100 * 1024 + 1, 0x78));

    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data.httpStatus).toBe(413);
    const largeSerialized = JSON.stringify(tooLarge.body);
    expect(largeSerialized).not.toContain('entity.too.large');
    expect(largeSerialized).not.toContain('request entity too large');
    expect(largeSerialized).not.toContain('ZodError');

    const badJson = await request(app.getHttpServer())
      .post('/trpc/search.global')
      .set('Content-Type', 'application/json')
      .send('{"q":"PARSER_LEAK_MARKER"');

    expect(badJson.status).toBe(400);
    expect(badJson.body.error.message).toBe('请求无法解析，请重试');
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
    const badSerialized = JSON.stringify(badJson.body);
    expect(badSerialized).not.toContain('PARSER_LEAK_MARKER');
    expect(badSerialized).not.toContain('Unexpected token');
    expect(badSerialized).not.toContain('is not valid JSON');
    expect(badSerialized).not.toContain('SyntaxError');
    expect(badSerialized).not.toContain('ZodError');
  });
});
