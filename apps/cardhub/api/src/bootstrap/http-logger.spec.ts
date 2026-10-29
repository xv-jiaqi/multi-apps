import { PassThrough } from 'node:stream';
import express from 'express';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { z } from 'zod';
import { attachLogLineReader, createHttpLoggerOptions } from './http-logger';

const logLineSchema = z.looseObject({
  requestId: z.string().nullable(),
  message: z.unknown().optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function listen(stream: PassThrough): string[] {
  const lines: string[] = [];
  attachLogLineReader(stream, (line) => {
    if (line.length > 0) lines.push(line);
  });
  return lines;
}

function parseLines(lines: string[]) {
  return lines.map((line) => logLineSchema.parse(JSON.parse(line)));
}

function statusCodeOf(line: unknown): number | undefined {
  if (typeof line !== 'object' || line === null || !('res' in line)) return undefined;
  const res = line.res;
  if (typeof res !== 'object' || res === null || !('statusCode' in res)) return undefined;
  return typeof res.statusCode === 'number' ? res.statusCode : undefined;
}

describe('http logger', () => {
  const previous = process.env.LOG_LEVEL;

  afterEach(() => {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
  });

  it('falls back to info when LOG_LEVEL is missing or invalid', () => {
    delete process.env.LOG_LEVEL;
    expect(createHttpLoggerOptions().level).toBe('info');
    process.env.LOG_LEVEL = 'debug';
    expect(createHttpLoggerOptions().level).toBe('debug');
    process.env.LOG_LEVEL = 'nope';
    expect(createHttpLoggerOptions().level).toBe('info');
  });

  it('echoes a valid id, replaces a bad one, and puts that id on every request line', async () => {
    const stream = new PassThrough();
    const lines = listen(stream);
    const middleware = pinoHttp(createHttpLoggerOptions(), stream);
    middleware.logger.info('startup');

    const app = express();
    app.use(middleware);
    app.use(express.json());
    app.get('/ok', (req, res) => {
      req.log.info('handler-log');
      res.status(204).end();
    });
    app.post('/secret', (_req, res) => {
      res.status(400).json({ ok: false });
    });

    const ok = await request(app).get('/ok').set('X-Request-Id', '  edge-7  ');
    expect(ok.status).toBe(204);
    expect(ok.headers['x-request-id']).toBe('edge-7');

    const bad = await request(app)
      .post('/secret')
      .set('X-Request-Id', 'id,other')
      .set('Authorization', 'Bearer LEAK_AUTH_MARKER')
      .set('Cookie', 'session=LEAK_COOKIE_MARKER')
      .send({ SECRET_BODY_MARKER: true });
    expect(bad.status).toBe(400);
    expect(bad.headers['x-request-id']).toMatch(UUID);
    expect(bad.headers['x-request-id']).not.toContain('id,other');

    const missing = await request(app).get('/ok');
    expect(missing.headers['x-request-id']).toMatch(UUID);

    const withQuery = await request(app)
      .get('/trpc/auth.verify')
      .query({ input: 'LEAK_QUERY_INPUT', token: 'LEAK_QUERY_TOKEN', page: '2' })
      .set('X-Request-Id', 'query-1');
    expect(withQuery.headers['x-request-id']).toBe('query-1');

    const parsed = parseLines(lines);
    expect(
      parsed.every((line) => line.requestId === null || typeof line.requestId === 'string'),
    ).toBe(true);
    expect(parsed.some((line) => line.message === 'startup' && line.requestId === null)).toBe(true);

    const handler = parsed.find((line) => line.message === 'handler-log');
    expect(handler?.requestId).toBe('edge-7');

    const rejected = parsed.find(
      (line) => line.requestId === bad.headers['x-request-id'] && statusCodeOf(line) === 400,
    );
    expect(rejected).toBeDefined();
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('LEAK_AUTH_MARKER');
    expect(serialized).not.toContain('LEAK_COOKIE_MARKER');
    expect(serialized).not.toContain('SECRET_BODY_MARKER');
    expect(serialized).not.toContain('id,other');
    expect(serialized).not.toContain('LEAK_QUERY_INPUT');
    expect(serialized).not.toContain('LEAK_QUERY_TOKEN');
    expect(serialized).toContain('[Redacted]');
    expect(serialized).toContain('page');
  });
});
