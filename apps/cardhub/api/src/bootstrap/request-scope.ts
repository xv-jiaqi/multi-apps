import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
import { REQUEST_ID_HEADER_NAME, requestIdFrom } from './request-id';

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function withRequestId(event: Event): Event {
  const requestId = currentRequestId();
  if (!requestId) return event;
  return {
    ...event,
    tags: {
      ...event.tags,
      request_id: requestId,
    },
  };
}

let processorInstalled = false;

export function installRequestIdProcessor(): void {
  if (processorInstalled) return;
  processorInstalled = true;
  Sentry.addEventProcessor((event) => withRequestId(event));
}

/**
 * Runs after pino-http has stored the request id on `req.id` and echoed it.
 * The isolation scope and the async store cover `captureException` calls that
 * do not pass their own tags, including the auth router's upgrade failure.
 */
export function bindRequestScope(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  installRequestIdProcessor();
  const requestId = requestIdFrom(req);
  if (requestId === undefined) {
    next();
    return;
  }
  if (!res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER_NAME, requestId);
  }
  requestContext.run({ requestId }, () => {
    Sentry.withIsolationScope((scope) => {
      scope.setTag('request_id', requestId);
      next();
    });
  });
}
