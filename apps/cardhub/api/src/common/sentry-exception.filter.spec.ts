jest.mock('@sentry/node', () => ({
  captureException: jest.fn(() => ''),
}));

import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { SentryExceptionFilter } from './sentry-exception.filter';

function capture(exception: unknown) {
  const json = jest.fn();
  const response = {
    status: jest.fn().mockReturnValue({ json }),
  };
  const request = { originalUrl: '/trpc/comments.create', method: 'POST' };
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

  it('does not report body-parser 413 or 400 errors', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      statusCode: 413,
    });
    const malformed = Object.assign(new Error('Unexpected token'), {
      type: 'entity.parse.failed',
      status: 400,
      statusCode: 400,
    });

    const large = capture(tooLarge);
    const bad = capture(malformed);

    expect(large.response.status).toHaveBeenCalledWith(413);
    expect(bad.response.status).toHaveBeenCalledWith(400);
    expect(bad.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Unexpected token',
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('does not report an HttpException 4xx', () => {
    const result = capture(new BadRequestException('nope'));
    expect(result.response.status).toHaveBeenCalledWith(400);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports a thrown Error and an HttpException 500', () => {
    const crash = new Error('database down');
    const http = new InternalServerErrorException('upstream failed');

    capture(crash);
    capture(http);

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
