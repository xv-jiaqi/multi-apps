import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';

/**
 * Forwards uncaught NestJS exceptions to Sentry while preserving the default
 * HTTP behaviour. Bound globally in `main.ts`. The filter is a no-op when
 * `SENTRY_DSN` is unset (Sentry never initialised → captureException becomes
 * silent), so local development sees no behavioural change.
 *
 * Note: tRPC errors flow through the Express middleware bypass, not Nest's
 * exception pipeline. They are reported separately by `tRPCErrorReporter` in
 * `trpc-base.ts` (`onError` hook) so we capture both pipelines without double
 * reporting.
 */
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: unknown = { message: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = exception.getResponse();
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error('Unknown exception', String(exception));
    }

    // Only forward 500-class crashes to Sentry; 4xx are user errors.
    if (status >= 500) {
      Sentry.captureException(exception, {
        tags: {
          path: request?.originalUrl ?? 'unknown',
          method: request?.method ?? 'unknown',
        },
      });
    }

    response.status(status).json(body);
  }
}
