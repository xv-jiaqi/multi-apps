import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { APP_ERROR_CODES, t } from '@repo/shared';

type RateLimitConfig = {
  windowMs: number;
  limit: number;
  skip: (req: { originalUrl?: string; url?: string }) => boolean;
};

type RateLimitOverrideConfig = Pick<RateLimitConfig, 'windowMs' | 'limit'>;

export type RateLimitName =
  | 'authMutation'
  | 'commentCreate'
  | 'forumTopicCreate'
  | 'forumReplyCreate'
  | 'listingPublish'
  | 'reportCreate'
  | 'collectionUpsert';

export type RateLimitOverrides = Partial<Record<RateLimitName, Partial<RateLimitOverrideConfig>>>;

type MountedRateLimiter = {
  path: string;
  middleware: RequestHandler;
};

// ipKeyGenerator collapses IPv6 prefixes so attackers can't rotate the
// last 64 bits to bypass the limit (the helper is mandatory in
// express-rate-limit 8.x — see ERR_ERL_KEY_GEN_IPV6). We wrap it so each
// limiter doesn't have to re-do the `req.ip ?? 'unknown'` dance.
const ipKey = (req: { ip?: string | undefined }): string => ipKeyGenerator(req.ip ?? 'unknown');
const urlDoesNotInclude =
  (needle: string) =>
  (req: { originalUrl?: string; url?: string }): boolean =>
    !(req.originalUrl ?? req.url ?? '').includes(needle);

function getTrpcPaths(req: Request): Array<string | undefined> {
  const pathname = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
  const trpcPath = pathname.replace(/^\/trpc\/?/, '').replace(/^\/+/, '');
  const paths = trpcPath
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
  return paths.length > 0 ? paths : [undefined];
}

function trpcTooManyRequestsError(path: string | undefined) {
  return {
    error: {
      message: t('zh-CN', 'error.app.TOO_MANY_REQUESTS'),
      code: -32029,
      data: {
        code: 'TOO_MANY_REQUESTS',
        appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
        httpStatus: 429,
        ...(path ? { path } : {}),
      },
    },
  };
}

function trpcRateLimitHandler(req: Request, res: Response): void {
  const paths = getTrpcPaths(req);
  const isBatch = req.query.batch === '1';
  const payload = isBatch
    ? paths.map((path) => trpcTooManyRequestsError(path))
    : trpcTooManyRequestsError(paths[0]);

  res.status(429).type('application/json').send(payload);
}

// tRPC procedures live behind Express middleware, so NestJS guards / the
// ThrottlerGuard do not intercept them. We layer express-rate-limit on the
// sensitive write paths instead. Reads (queries) stay un-throttled here.
// Counters live in Redis so API replicas share one bucket. Each limiter has
// its own prefix. passOnStoreError lets the request through when Redis is down.
//
// Why per-route limiters instead of a single global one: each mutation has
// a different abuse profile — login attempts deserve a 1-minute window
// while topic creation deserves a 1-hour window. A single limiter would
// either be too lax to deter spam or too strict to be usable.
export const RATE_LIMIT_KEY_PREFIX = 'cardhub:rl:v1:';

export function defaultRateLimitPrefix(): string {
  if (process.env.NODE_ENV === 'test') return `cardhub:rl:test:${randomUUID()}:`;
  return RATE_LIMIT_KEY_PREFIX;
}

export function rateLimitStorePrefix(name: RateLimitName, base: string): string {
  return `${base}${name}:`;
}

type RateLimitRedis = {
  sendCommand(args: readonly string[]): Promise<unknown>;
};

const rateLimitLogger = new Logger('RateLimit');

function storeLog(error: unknown, message?: string): void {
  const detail = error instanceof Error ? error.message : '';
  const text =
    message && detail ? `${message}: ${detail}` : message || detail || 'rate limit store error';
  rateLimitLogger.warn(text);
}

const redisStoreLogger = {
  error: storeLog,
  warn: storeLog,
};

function isRedisData(value: unknown): value is boolean | number | string {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function toRedisReply(value: unknown): RedisReply {
  if (value === null || value === undefined) return false;
  if (Buffer.isBuffer(value)) return value.toString();
  if (isRedisData(value)) return value;
  if (!Array.isArray(value)) throw new Error('Unexpected Redis reply');

  const items: Array<boolean | number | string> = [];
  for (const item of value) {
    if (item === null || item === undefined) {
      items.push(false);
      continue;
    }
    if (Buffer.isBuffer(item)) {
      items.push(item.toString());
      continue;
    }
    if (!isRedisData(item)) throw new Error('Unexpected Redis reply');
    items.push(item);
  }
  return items;
}

async function sendRedisCommand(
  redis: RateLimitRedis,
  args: readonly string[],
): Promise<RedisReply> {
  return toRedisReply(await redis.sendCommand(args));
}

function createRedisStore(redis: RateLimitRedis, prefix: string): RedisStore {
  const store = new RedisStore({
    prefix,
    sendCommand: (...command: string[]) => sendRedisCommand(redis, command),
  });
  // SCRIPT LOAD starts in the constructor. A rejected promise with no handler
  // crashes Node, which would take the API down whenever Redis is down.
  void store.incrementScriptSha.catch(() => undefined);
  void store.getScriptSha.catch(() => undefined);
  return store;
}

export const productionRateLimitConfigs: Record<RateLimitName, RateLimitConfig> = {
  authMutation: {
    windowMs: 60_000,
    limit: 10,
    skip: (req) => {
      const url = req.originalUrl ?? req.url ?? '';
      return (
        !url.includes('auth.register') &&
        !url.includes('auth.login') &&
        !url.includes('auth.changePassword')
      );
    },
  },
  commentCreate: {
    windowMs: 60 * 60_000,
    limit: 30,
    skip: urlDoesNotInclude('comments.create'),
  },
  forumTopicCreate: {
    windowMs: 60 * 60_000,
    limit: 5,
    skip: urlDoesNotInclude('forum.topics.create'),
  },
  forumReplyCreate: {
    windowMs: 60 * 60_000,
    limit: 30,
    skip: urlDoesNotInclude('forum.replies.create'),
  },
  listingPublish: {
    windowMs: 60 * 60_000,
    limit: 10,
    skip: urlDoesNotInclude('listings.publish'),
  },
  reportCreate: {
    windowMs: 60 * 60_000,
    limit: 20,
    skip: urlDoesNotInclude('reports.create'),
  },
  collectionUpsert: {
    windowMs: 60_000,
    limit: 60,
    skip: urlDoesNotInclude('collection.upsert'),
  },
};

export function createRateLimiters(
  redis: RateLimitRedis,
  overrides: RateLimitOverrides = {},
  keyPrefix: string = defaultRateLimitPrefix(),
): MountedRateLimiter[] {
  return (Object.entries(productionRateLimitConfigs) as [RateLimitName, RateLimitConfig][]).map(
    ([name, config]) => {
      const resolved = { ...config, ...overrides[name] };
      return {
        path: '/trpc',
        middleware: rateLimit({
          windowMs: resolved.windowMs,
          limit: resolved.limit,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
          keyGenerator: ipKey,
          skip: resolved.skip,
          handler: trpcRateLimitHandler,
          passOnStoreError: true,
          logger: redisStoreLogger,
          store: createRedisStore(redis, rateLimitStorePrefix(name, keyPrefix)),
        }),
      };
    },
  );
}
