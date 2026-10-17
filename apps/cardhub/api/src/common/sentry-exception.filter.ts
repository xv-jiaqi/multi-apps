import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { t } from '@repo/shared';
import type { Request, Response } from 'express';
import { isAdminCatalogImportRequest } from '../bootstrap/json-body';

/**
 * Forwards uncaught NestJS exceptions to Sentry while preserving the default
 * HTTP behaviour. Bound globally in `main.ts`. The filter is a no-op when
 * `SENTRY_DSN` is unset (Sentry never initialised → captureException becomes
 * silent), so local development sees no behavioural change.
 *
 * Note: tRPC errors flow through the Express middleware bypass, not Nest's
 * exception pipeline. They are reported separately by the tRPC `onError`
 * hook in `create-app.ts` so we capture both pipelines without double
 * reporting.
 *
 * Only known body-parser / http-errors `type` values are treated as client
 * errors. Each type gets a fixed message — never `exception.message`, which
 * can include parser snippets or other internal detail. Every other error,
 * including a plain Error that merely carries a 4xx `status`, is answered
 * with generic copy and reported to Sentry when it is a 5xx.
 */
const PARSER_CLIENT_ERRORS: Record<string, 400 | 403 | 413 | 415> = {
  'entity.too.large': 413,
  'parameters.too.many': 413,
  'entity.parse.failed': 400,
  'request.aborted': 400,
  'request.size.invalid': 400,
  'querystring.parse.rangeError': 400,
  'entity.verify.failed': 403,
  'charset.unsupported': 415,
  'encoding.unsupported': 415,
};

function parserClientStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const type = (exception as { type?: unknown }).type;
  if (typeof type !== 'string') return undefined;
  return PARSER_CLIENT_ERRORS[type];
}

function parserClientMessage(status: number, request: Request | undefined): string {
  if (status === 413) {
    const key =
      request && isAdminCatalogImportRequest(request)
        ? 'admin.import.tooLarge'
        : 'error.payloadTooLarge';
    return t('zh-CN', key);
  }
  if (status === 415) return t('zh-CN', 'error.unsupportedMedia');
  if (status === 403) return t('zh-CN', 'error.requestRejected');
  return t('zh-CN', 'error.malformedRequest');
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
      const clientStatus = parserClientStatus(exception);
      if (clientStatus !== undefined) {
        status = clientStatus;
        body = {
          statusCode: clientStatus,
          message: parserClientMessage(clientStatus, request),
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
      this.logger.warn(exception.message);
    }

    response.status(status).json(body);
  }
}
