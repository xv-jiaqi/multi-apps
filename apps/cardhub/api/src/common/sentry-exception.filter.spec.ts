jest.mock('@sentry/node', () => ({
  captureException: jest.fn(() => ''),
}));

import { BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';
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
      error: {
        message: '内容太大，请精简后重试',
        code: -32013,
        data: {
          code: 'PAYLOAD_TOO_LARGE',
          httpStatus: 413,
          appCode: 'PAYLOAD_TOO_LARGE',
          path: 'comments.create',
        },
      },
    });
    expect(importRoute.response.status).toHaveBeenCalledWith(413);
    expect(importRoute.json).toHaveBeenCalledWith({
      error: {
        message: '一次最多导入 1MB',
        code: -32013,
        data: {
          code: 'PAYLOAD_TOO_LARGE',
          httpStatus: 413,
          appCode: 'PAYLOAD_TOO_LARGE',
          path: 'admin.catalog.import',
        },
      },
    });
    expect(bad.response.status).toHaveBeenCalledWith(400);
    expect(bad.json).toHaveBeenCalledWith({
      error: {
        message: '请求无法解析，请重试',
        code: -32600,
        data: {
          code: 'BAD_REQUEST',
          httpStatus: 400,
          appCode: 'PARSE_ERROR',
          path: 'comments.create',
        },
      },
    });
    expect(many.json).toHaveBeenCalledWith({
      error: {
        message: '内容太大，请精简后重试',
        code: -32013,
        data: {
          code: 'PAYLOAD_TOO_LARGE',
          httpStatus: 413,
          appCode: 'PAYLOAD_TOO_LARGE',
          path: 'comments.create',
        },
      },
    });
    expect(media.json).toHaveBeenCalledWith({
      error: {
        message: '不支持这种内容格式',
        code: -32015,
        data: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          httpStatus: 415,
          path: 'comments.create',
        },
      },
    });
    expect(rejected.json).toHaveBeenCalledWith({
      error: {
        message: '请求未能通过校验',
        code: -32003,
        data: {
          code: 'FORBIDDEN',
          httpStatus: 403,
          path: 'comments.create',
        },
      },
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
    expect(result.json).toHaveBeenCalledWith({ message: '出了点问题，请稍后再试' });
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

  it('replaces a Nest BadRequestException built from a JSON SyntaxError', () => {
    const leaked = `Unexpected token '}', ..."{"rows":[LEAK_MARKER]}" is not valid JSON`;
    const wrapped = new BadRequestException(leaked);
    const onTrpc = capture(wrapped);
    const outside = capture(wrapped, '/health');

    expect(onTrpc.response.status).toHaveBeenCalledWith(400);
    expect(onTrpc.json).toHaveBeenCalledWith({
      error: {
        message: '请求无法解析，请重试',
        code: -32600,
        data: {
          code: 'BAD_REQUEST',
          httpStatus: 400,
          appCode: 'PARSE_ERROR',
          path: 'comments.create',
        },
      },
    });
    expect(outside.response.status).toHaveBeenCalledWith(400);
    expect(outside.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: '请求无法解析，请重试',
    });
    const serialized = JSON.stringify([onTrpc.json.mock.calls, outside.json.mock.calls]);
    expect(serialized).not.toContain('LEAK_MARKER');
    expect(serialized).not.toContain('Unexpected token');
    expect(serialized).not.toContain('is not valid JSON');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not pass through body-parser types carried on an HttpException', () => {
    const tooLarge = Object.assign(
      new BadRequestException('request entity too large LIMIT_SECRET'),
      {
        type: 'entity.too.large',
      },
    );
    const charset = Object.assign(new HttpException('unsupported charset "UTF-99-SECRET"', 400), {
      type: 'charset.unsupported',
    });
    const verify = Object.assign(new HttpException('verify failed: internal token abc', 403), {
      type: 'entity.verify.failed',
    });

    const large = capture(tooLarge, '/trpc/admin.catalog.import');
    const media = capture(charset, '/health');
    const rejected = capture(verify);

    expect(large.json).toHaveBeenCalledWith({
      error: {
        message: '一次最多导入 1MB',
        code: -32013,
        data: {
          code: 'PAYLOAD_TOO_LARGE',
          httpStatus: 413,
          appCode: 'PAYLOAD_TOO_LARGE',
          path: 'admin.catalog.import',
        },
      },
    });
    expect(media.response.status).toHaveBeenCalledWith(415);
    expect(media.json).toHaveBeenCalledWith({
      statusCode: 415,
      message: '不支持这种内容格式',
    });
    expect(rejected.json).toHaveBeenCalledWith({
      error: {
        message: '请求未能通过校验',
        code: -32003,
        data: {
          code: 'FORBIDDEN',
          httpStatus: 403,
          path: 'comments.create',
        },
      },
    });
    const serialized = JSON.stringify([
      large.json.mock.calls,
      media.json.mock.calls,
      rejected.json.mock.calls,
    ]);
    expect(serialized).not.toContain('LIMIT_SECRET');
    expect(serialized).not.toContain('UTF-99-SECRET');
    expect(serialized).not.toContain('internal token');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not report an HttpException 4xx and keeps its response body', () => {
    const result = capture(new BadRequestException('保留原文'));
    expect(result.response.status).toHaveBeenCalledWith(400);
    expect(result.json).toHaveBeenCalledWith({
      message: '保留原文',
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
    expect(crashed.json).toHaveBeenCalledWith({ message: '出了点问题，请稍后再试' });
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
