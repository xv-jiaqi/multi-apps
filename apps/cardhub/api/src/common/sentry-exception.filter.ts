import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';
import { t } from '@repo/shared';
import {
  clientParserHttpBody,
  parserClientFailure,
  type ParserFailure,
} from '../bootstrap/json-body';
import { requestIdFrom } from '../bootstrap/request-id';

/**
 * Forwards uncaught NestJS exceptions to Sentry while preserving the default
 * HTTP behaviour. Bound globally in `create-app.ts`. The filter is a no-op
 * when `SENTRY_DSN` is unset (Sentry never initialised → captureException
 * becomes silent), so local development sees no behavioural change.
 *
 * Note: tRPC errors flow through the Express middleware bypass, not Nest's
 * exception pipeline. They are reported separately by the tRPC `onError`
 * hook in `create-app.ts` so we capture both pipelines without double
 * reporting.
 *
 * Known body-parser `type` values are answered with fixed copy. Nest's
 * `RoutesResolver.mapExternalException` also wraps a body-parser `SyntaxError`
 * in `BadRequestException(err.message)` before this filter runs, which drops
 * `type` and leaves the parser text (including a slice of the body) in the
 * response. Those messages are replaced with the same fixed copy. Every other
 * error keeps a generic body and is reported to Sentry when it is a 5xx.
 * Intentional `HttpException` responses are unchanged.
 */
const JSON_SYNTAX_LEAK_MARKERS = [
  'is not valid JSON',
  'in JSON at position',
  'Unexpected end of JSON',
  'Unterminated string in JSON',
  'Bad control character in string literal in JSON',
  'Bad Unicode escape in JSON',
  'Expected property name or',
];

function causeOf(exception: unknown): unknown {
  if (typeof exception !== 'object' || exception === null || !('cause' in exception)) {
    return undefined;
  }
  return exception.cause;
}

function parserFailureOf(exception: unknown): ParserFailure | undefined {
  return parserClientFailure(exception) ?? parserClientFailure(causeOf(exception));
}

function responseText(exception: HttpException): string {
  const response = exception.getResponse();
  const parts = [exception.message];
  if (typeof response === 'string') {
    parts.push(response);
  } else if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') parts.push(message);
    else if (Array.isArray(message)) parts.push(message.map(String).join(' '));
  }
  return parts.join('\n');
}

function isJsonSyntaxLeak(exception: unknown): boolean {
  if (!(exception instanceof HttpException) || exception.getStatus() >= 500) return false;
  const text = responseText(exception);
  return JSON_SYNTAX_LEAK_MARKERS.some((marker) => text.includes(marker));
}

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: unknown = { message: t('zh-CN', 'error.internal') };
    let failure = parserFailureOf(exception);
    if (!failure && isJsonSyntaxLeak(exception)) {
      const leaked: ParserFailure = { status: 400, reason: 'parse' };
      failure = leaked;
    }

    if (failure) {
      status = failure.status;
      body = clientParserHttpBody(request, failure);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = exception.getResponse();
    }

    if (status >= 500) {
      if (!(exception instanceof HttpException)) {
        if (exception instanceof Error) {
          this.logger.error(exception.message, exception.stack);
        } else {
          this.logger.error('Unknown exception', String(exception));
        }
      }
      const requestId = requestIdFrom(request);
      const tags: Record<string, string> = {
        path: request?.originalUrl ?? 'unknown',
        method: request?.method ?? 'unknown',
      };
      if (requestId) tags.request_id = requestId;
      Sentry.captureException(exception, { tags });
    } else if (failure) {
      this.logger.warn(`Rejected a client parser error with status ${failure.status}`);
    } else if (!(exception instanceof HttpException) && exception instanceof Error) {
      this.logger.warn(exception.message);
    }

    response.status(status).json(body);
  }
}
