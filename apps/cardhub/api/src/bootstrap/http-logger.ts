import { hostname } from 'node:os';
import { PassThrough } from 'node:stream';
import { nativeLoggerOptions, PinoLogger } from 'nestjs-pino';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';
import { requestIdFrom, requestIdSchema, resolveRequestId } from './request-id';
import { bindRequestScope } from './request-scope';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const SECRET_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization']);

/** tRPC puts the procedure payload in `input`. The other names are credential query params. */
const REDACTED_QUERY_KEYS = new Set([
  'input',
  'token',
  'code',
  'access_token',
  'refresh_token',
  'id_token',
  'reset_token',
]);

const REQUEST_LOG_FIELDS: readonly string[] = [
  'id',
  'method',
  'url',
  'query',
  'params',
  'remoteAddress',
  'remotePort',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loggedRequestIdHeader(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = requestIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : '[Redacted]';
}

function decodeQueryKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    return rawKey;
  }
}

function redactQuery(query: unknown): unknown {
  if (Array.isArray(query)) return query.map((item) => redactQuery(item));
  if (!isRecord(query)) return query;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    out[key] = REDACTED_QUERY_KEYS.has(key.toLowerCase()) ? '[Redacted]' : value;
  }
  return out;
}

function redactUrl(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return url;
  const path = url.slice(0, queryIndex);
  const redacted = url
    .slice(queryIndex + 1)
    .split('&')
    .map((part) => {
      if (part.length === 0) return part;
      const eq = part.indexOf('=');
      const rawKey = eq === -1 ? part : part.slice(0, eq);
      if (!REDACTED_QUERY_KEYS.has(decodeQueryKey(rawKey).toLowerCase())) return part;
      return `${rawKey}=${encodeURIComponent('[Redacted]')}`;
    })
    .join('&');
  return `${path}?${redacted}`;
}

function redactHeaders(headers: unknown): Record<string, unknown> | undefined {
  if (!isRecord(headers)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (SECRET_HEADERS.has(normalized)) {
      out[key] = '[Redacted]';
      continue;
    }
    if (normalized === 'x-request-id') {
      out[key] = loggedRequestIdHeader(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * pino-http wraps this with its own serializer first, then calls us with that
 * plain object. `raw` is the live request, including the body, so it is dropped.
 */
export function redactSerializedRequest(req: unknown): Record<string, unknown> {
  if (!isRecord(req)) return {};
  const out: Record<string, unknown> = {};
  for (const key of REQUEST_LOG_FIELDS) {
    if (key in req && req[key] !== undefined) {
      out[key] = req[key];
    }
  }
  if (typeof out.url === 'string') out.url = redactUrl(out.url);
  if ('query' in out) out.query = redactQuery(out.query);
  const headers = redactHeaders(req.headers);
  if (headers) out.headers = headers;
  return out;
}

export function redactSerializedResponse(res: unknown): Record<string, unknown> {
  if (!isRecord(res)) return {};
  const out: Record<string, unknown> = {};
  if (typeof res.statusCode === 'number') out.statusCode = res.statusCode;
  const headers = redactHeaders(res.headers);
  if (headers) out.headers = headers;
  return out;
}

/**
 * JSON logs for the API process.
 *
 * `requestId: null` lives on the root bindings so every line has the field.
 * A request child sets the same key to the real id. Pino writes child bindings
 * after the parent, and JSON.parse keeps the last duplicate key.
 */
export function createHttpLoggerOptions(): Options {
  const level = logLevelSchema.safeParse(process.env.LOG_LEVEL);
  return {
    ...nativeLoggerOptions,
    level: level.success ? level.data : 'info',
    base: {
      pid: process.pid,
      hostname: hostname(),
      requestId: null,
    },
    quietReqLogger: true,
    customAttributeKeys: {
      reqId: 'requestId',
    },
    wrapSerializers: true,
    serializers: {
      req: redactSerializedRequest,
      res: redactSerializedResponse,
    },
    genReqId(req: IncomingMessage, res: ServerResponse) {
      const requestId = resolveRequestId(req.headers['x-request-id']);
      res.setHeader('X-Request-Id', requestId);
      return requestId;
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  };
}

const logLineListeners = new Set<(line: string) => void>();

export function subscribeLogLines(listener: (line: string) => void): () => void {
  logLineListeners.add(listener);
  return () => {
    logLineListeners.delete(listener);
  };
}

export function attachLogLineReader(stream: PassThrough, onLine: (line: string) => void): void {
  let pending = '';
  stream.on('data', (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (process.env.NODE_ENV !== 'test') {
      process.stdout.write(text);
    }
    pending += text;
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      onLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
}

export const appLogStream = new PassThrough();

attachLogLineReader(appLogStream, (line) => {
  for (const listener of logLineListeners) listener(line);
});

type RequestLoggingApp = {
  use(handler: RequestHandler): unknown;
};

/**
 * Mounts pino-http before any middleware that can end the response.
 *
 * Nest applies `LoggerModule` middleware inside `init()`, after the `app.use`
 * calls in `createApp`. The JSON parser answers 400 and 413 without calling
 * `next()`, so a middleware registered later never sees those requests.
 * `forRoutes` stays empty so Nest does not mount a second copy.
 *
 * `PinoLogger` is request-scoped, so it cannot be fetched with `app.get`.
 * `runInContext` only needs the root logger, which the constructor reuses.
 */
export function attachRequestLogging(
  app: RequestLoggingApp,
  stream: PassThrough = appLogStream,
): void {
  const options = createHttpLoggerOptions();
  const pinoLogger = new PinoLogger({ pinoHttp: [options, stream] });
  const httpLogger = pinoHttp(options, stream);
  app.use((req: Request, res: Response, next: NextFunction) => {
    httpLogger(req, res, () => {
      bindRequestScope(req, res, () => {
        const requestId = requestIdFrom(req);
        if (requestId === undefined) {
          next();
          return;
        }
        pinoLogger.runInContext(
          () => {
            next();
          },
          { bindings: { requestId } },
        );
      });
    });
  });
}
