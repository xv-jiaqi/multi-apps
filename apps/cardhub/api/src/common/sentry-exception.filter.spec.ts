jest.mock('@sentry/node', () => ({
  captureException: jest.fn(() => ''),
}));

import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { SentryExceptionFilter } from './sentry-exception.filter';

function capture(exception: unknown, originalUrl = '/trpc/comments.create') {
  const json = jest.fn();
  const response = {
    status: jest.fn().mockReturnValue({ json }),
  };
  const request = { originalUrl, method: 'POST' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new SentryExceptionFilter().catch(exception, host);
  return { response, json };
}

describe('SentryExceptionFilter', () => {
  const captureException = Sentry.captureException as jest.Mock;

  beforeEach(() => {
    captureException.mockClear();
  });

  it('answers whitelisted body-parser errors with a fixed message', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      statusCode: 413,
    });
    const malformed = Object.assign(new Error('Unexpected token near secret=db-password'), {
      type: 'entity.parse.failed',
      status: 418,
      statusCode: 418,
    });
    const tooMany = Object.assign(new Error('too many parameters'), {
      type: 'parameters.too.many',
      status: 413,
    });
    const charset = Object.assign(new Error('unsupported charset "UTF-99"'), {
      type: 'charset.unsupported',
      status: 415,
    });
    const verify = Object.assign(new Error('verify failed: internal token abc'), {
      type: 'entity.verify.failed',
      status: 403,
    });

    const large = capture(tooLarge);
    const bad = capture(malformed);
    const many = capture(tooMany);
    const media = capture(charset);
    const rejected = capture(verify);
    const importRoute = capture(tooLarge, '/trpc/admin.catalog.import');

    expect(large.response.status).toHaveBeenCalledWith(413);
    expect(large.json).toHaveBeenCalledWith({
      statusCode: 413,
      message: '内容太大，请精简后重试',
    });
    expect(importRoute.response.status).toHaveBeenCalledWith(413);
    expect(importRoute.json).toHaveBeenCalledWith({
      statusCode: 413,
      message: '一次最多导入 1MB',
    });
    expect(bad.response.status).toHaveBeenCalledWith(400);
    expect(bad.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: '请求格式有误',
    });
    expect(many.json).toHaveBeenCalledWith({
      statusCode: 413,
      message: '内容太大，请精简后重试',
    });
    expect(media.json).toHaveBeenCalledWith({
      statusCode: 415,
      message: '不支持这种内容格式',
    });
    expect(rejected.json).toHaveBeenCalledWith({
      statusCode: 403,
      message: '请求未能通过校验',
    });

    const serialized = JSON.stringify([
      large.json.mock.calls,
      bad.json.mock.calls,
      many.json.mock.calls,
      media.json.mock.calls,
      rejected.json.mock.calls,
      importRoute.json.mock.calls,
    ]);
    expect(serialized).not.toContain('request entity too large');
    expect(serialized).not.toContain('db-password');
    expect(serialized).not.toContain('UTF-99');
    expect(serialized).not.toContain('internal token');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not pass through an ordinary Error that only has a 4xx status', () => {
    const secret = 'postgres://user:s3cret@db.internal/cardhub';
    const forged = Object.assign(new Error(secret), {
      status: 418,
      statusCode: 418,
    });

    const result = capture(forged);

    expect(result.response.status).toHaveBeenCalledWith(500);
    expect(result.json).toHaveBeenCalledWith({ message: 'Internal server error' });
    expect(JSON.stringify(result.json.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(result.json.mock.calls)).not.toContain('s3cret');
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      forged,
      expect.objectContaining({
        tags: { path: '/trpc/comments.create', method: 'POST' },
      }),
    );
  });

  it('does not report an HttpException 4xx and keeps its response body', () => {
    const result = capture(new BadRequestException('nope'));
    expect(result.response.status).toHaveBeenCalledWith(400);
    expect(result.json).toHaveBeenCalledWith({
      message: 'nope',
      error: 'Bad Request',
      statusCode: 400,
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports a thrown Error and an HttpException 500', () => {
    const crash = new Error('database down');
    const http = new InternalServerErrorException('upstream failed');

    const crashed = capture(crash);
    capture(http);

    expect(crashed.response.status).toHaveBeenCalledWith(500);
    expect(crashed.json).toHaveBeenCalledWith({ message: 'Internal server error' });
    expect(JSON.stringify(crashed.json.mock.calls)).not.toContain('database down');
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenNthCalledWith(
      1,
      crash,
      expect.objectContaining({
        tags: { path: '/trpc/comments.create', method: 'POST' },
      }),
    );
    expect(captureException).toHaveBeenNthCalledWith(
      2,
      http,
      expect.objectContaining({
        tags: { path: '/trpc/comments.create', method: 'POST' },
      }),
    );
  });
});
