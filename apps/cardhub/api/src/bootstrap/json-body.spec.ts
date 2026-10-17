jest.mock('@sentry/node', () => ({
  captureException: jest.fn(() => ''),
}));

import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { SentryExceptionFilter } from '../common/sentry-exception.filter';
import { CATALOG_IMPORT_HTTP_BODY_LIMIT, jsonBodyParser } from './json-body';

const DEFAULT_LIMIT_BYTES = 100 * 1024;

function makeApp() {
  const captureException = Sentry.captureException as jest.Mock;
  captureException.mockClear();
  const filter = new SentryExceptionFilter();
  const app = express();
  let commentsReached = false;
  let importReached = false;

  app.use(jsonBodyParser());
  app.post('/trpc/comments.create', (_req, res) => {
    commentsReached = true;
    res.status(200).json({ ok: true });
  });
  app.post('/trpc/admin.catalog.import', (_req, res) => {
    importReached = true;
    res.status(200).json({ ok: true });
  });
  app.get('/boom', (_req, _res, next) => {
    next(new Error('database down'));
  });
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    filter.catch(error, {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost);
  });

  return {
    app,
    captureException,
    commentsReached: () => commentsReached,
    importReached: () => importReached,
  };
}

describe('json body limits', () => {
  it('returns a tRPC 413 for a non-import route over the default cap without reporting to Sentry', async () => {
    const harness = makeApp();
    const response = await request(harness.app)
      .post('/trpc/comments.create?batch=1')
      .set('Content-Type', 'application/json')
      .send(Buffer.alloc(DEFAULT_LIMIT_BYTES + 1, 0x78));

    expect(response.status).toBe(413);
    expect(response.body).toEqual([
      {
        error: {
          message: '一次最多导入 1MB',
          code: -32013,
          data: {
            code: 'PAYLOAD_TOO_LARGE',
            httpStatus: 413,
            path: 'comments.create',
          },
        },
      },
    ]);
    expect(harness.captureException).not.toHaveBeenCalled();
    expect(harness.commentsReached()).toBe(false);
  });

  it('returns 413 for an import body one byte over 1MB + 16KB', async () => {
    const harness = makeApp();
    const response = await request(harness.app)
      .post('/trpc/admin.catalog.import')
      .set('Content-Type', 'application/json')
      .send(Buffer.alloc(CATALOG_IMPORT_HTTP_BODY_LIMIT + 1, 0x78));

    expect(response.status).toBe(413);
    expect(response.body.error.data).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      httpStatus: 413,
      path: 'admin.catalog.import',
    });
    expect(harness.captureException).not.toHaveBeenCalled();
    expect(harness.importReached()).toBe(false);
  });

  it('still accepts a normal comments body and an import body above 100kb', async () => {
    const harness = makeApp();

    const comment = await request(harness.app)
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .send({ cardSlug: 'demo-card', content: 'hello' });
    expect(comment.status).toBe(200);
    expect(harness.commentsReached()).toBe(true);

    const importBody = {
      dryRun: true,
      data: [{ slug: 'wide-series', title: 'Wide', description: 'x'.repeat(150_000) }],
    };
    expect(Buffer.byteLength(JSON.stringify(importBody))).toBeGreaterThan(DEFAULT_LIMIT_BYTES);
    expect(Buffer.byteLength(JSON.stringify(importBody))).toBeLessThanOrEqual(
      CATALOG_IMPORT_HTTP_BODY_LIMIT,
    );
    const imported = await request(harness.app)
      .post('/trpc/admin.catalog.import')
      .set('Content-Type', 'application/json')
      .send(importBody);
    expect(imported.status).toBe(200);
    expect(harness.importReached()).toBe(true);
    expect(harness.captureException).not.toHaveBeenCalled();
  });

  it('answers malformed JSON with 400 and does not report it as a Sentry error', async () => {
    const harness = makeApp();
    const response = await request(harness.app)
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(harness.captureException).not.toHaveBeenCalled();
    expect(harness.commentsReached()).toBe(false);
  });

  it('still reports a real 500 to Sentry', async () => {
    const harness = makeApp();
    const response = await request(harness.app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Internal server error' });
    expect(harness.captureException).toHaveBeenCalledTimes(1);
    expect(harness.captureException.mock.calls[0]?.[0]).toEqual(expect.any(Error));
    expect((harness.captureException.mock.calls[0]?.[0] as Error).message).toBe('database down');
  });
});
