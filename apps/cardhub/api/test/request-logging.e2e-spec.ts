import type { INestApplication } from '@nestjs/common';
import { APP_ERROR_CODES } from '@repo/shared';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/bootstrap/create-app';
import { subscribeLogLines } from '../src/bootstrap/http-logger';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const logLineSchema = z.looseObject({
  requestId: z.string().nullable(),
  message: z.unknown().optional(),
  code: z.string().optional(),
});

function statusCodeOf(line: unknown): number | undefined {
  if (typeof line !== 'object' || line === null || !('res' in line)) return undefined;
  const res = line.res;
  if (typeof res !== 'object' || res === null || !('statusCode' in res)) return undefined;
  return typeof res.statusCode === 'number' ? res.statusCode : undefined;
}

describe('request logging through the Nest bootstrap', () => {
  let app: INestApplication;
  const lines: string[] = [];
  let unsubscribe: (() => void) | undefined;

  beforeAll(async () => {
    unsubscribe = subscribeLogLines((line) => {
      if (line.length > 0) lines.push(line);
    });
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    unsubscribe?.();
    await app?.close();
  });

  function parsedSince(start: number) {
    return lines.slice(start).map((line) => logLineSchema.parse(JSON.parse(line)));
  }

  it('keeps parser 400 and 413 bodies and echoes the request id into the JSON log', async () => {
    const start = lines.length;
    const badJson = await request(app.getHttpServer())
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', 'parse-400')
      .send('{"content":"PARSER_LEAK_MARKER"');

    expect(badJson.status).toBe(400);
    expect(badJson.headers['x-request-id']).toBe('parse-400');
    expect(badJson.body.error.message).toBe('请求无法解析，请重试');
    expect(badJson.body.error.data.code).toBe('BAD_REQUEST');
    expect(badJson.body.error.data.appCode).toBe(APP_ERROR_CODES.PARSE_ERROR);
    expect(JSON.stringify(badJson.body)).not.toContain('PARSER_LEAK_MARKER');

    const tooLarge = await request(app.getHttpServer())
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', 'too-large-413')
      .send(Buffer.alloc(100 * 1024 + 1, 0x78));

    expect(tooLarge.status).toBe(413);
    expect(tooLarge.headers['x-request-id']).toBe('too-large-413');
    expect(tooLarge.body.error.message).toBe('内容太大，请精简后重试');
    expect(tooLarge.body.error.data.code).toBe('PAYLOAD_TOO_LARGE');
    expect(tooLarge.body.error.data.appCode).toBe(APP_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(tooLarge.body.error.data.httpStatus).toBe(413);

    const generated = await request(app.getHttpServer()).get('/health');
    expect(generated.headers['x-request-id']).toMatch(UUID);

    const rejected = await request(app.getHttpServer())
      .get('/trpc/missing.procedure')
      .set('X-Request-Id', 'trpc-miss-1');
    expect(rejected.headers['x-request-id']).toBe('trpc-miss-1');

    const parsed = parsedSince(start);
    expect(
      parsed.every((line) => line.requestId === null || typeof line.requestId === 'string'),
    ).toBe(true);
    expect(
      parsed.some((line) => line.requestId === 'parse-400' && statusCodeOf(line) === 400),
    ).toBe(true);
    expect(
      parsed.some((line) => line.requestId === 'too-large-413' && statusCodeOf(line) === 413),
    ).toBe(true);
    expect(
      parsed.some((line) => line.requestId === 'trpc-miss-1' && line.code === 'NOT_FOUND'),
    ).toBe(true);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('PARSER_LEAK_MARKER');
  });
});
