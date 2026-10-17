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
 * exception pipeline. They are reported separately by the tRPC `onError`
 * hook in `create-app.ts` so we capture both pipelines without double
 * reporting. Body-parser 4xx errors (413 / malformed JSON) keep their status
 * and are logged as warnings; only 5xx is sent to Sentry as an error.
 */
function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const record = exception as { statusCode?: unknown; status?: unknown };
  const status = record.statusCode ?? record.status;
  if (typeof status !== 'number' || status < 400 || status >= 500) return undefined;
  return status;
}

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
    } else {
      const clientStatus = clientErrorStatus(exception);
      if (clientStatus !== undefined) {
        status = clientStatus;
        body = {
          statusCode: clientStatus,
          message: exception instanceof Error ? exception.message : 'Bad Request',
        };
      }
    }

    if (status >= 500) {
      if (!(exception instanceof HttpException)) {
        if (exception instanceof Error) {
          this.logger.error(exception.message, exception.stack);
        } else {
          this.logger.error('Unknown exception', String(exception));
        }
      }
      Sentry.captureException(exception, {
        tags: {
          path: request?.originalUrl ?? 'unknown',
          method: request?.method ?? 'unknown',
        },
      });
    } else if (!(exception instanceof HttpException) && exception instanceof Error) {
      // Body-parser 413/400 and other client errors are not server failures.
      this.logger.warn(exception.message);
    }

    response.status(status).json(body);
  }
}
