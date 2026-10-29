import { Logger } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator, MemoryStore, type Store } from 'express-rate-limit';
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

function getTrpcPaths(req: { originalUrl?: string; url?: string }): Array<string | undefined> {
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
// its own prefix. When Redis errors, a write falls back to a process-local
// counter with the same limit instead of being allowed through.
//
// Login has a second bucket keyed by a hash of the normalized identifier.
// The window matches authMutation (60s, 10). A successful login deletes that
// key, so a person who knows the password is not locked out, and a wrong
// password never gets a long lock.
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

let redisRateLimitErrors = 0;

/** How many rate-limit Redis commands have failed in this process. */
export function rateLimitRedisErrorCount(): number {
  return redisRateLimitErrors;
}

function noteRedisRateLimitError(error: unknown): void {
  redisRateLimitErrors += 1;
  const detail = error instanceof Error ? error.message : 'unknown';
  rateLimitLogger.warn(`redis error #${redisRateLimitErrors}: ${detail}`);
}

/**
 * Redis first. A store error uses the in-process counter so a write is still
 * limited. The memory counter does not survive a restart and is not shared
 * across API replicas.
 */
class RedisMemoryFallbackStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;

  constructor(
    private readonly redisStore: RedisStore,
    private readonly memoryStore: MemoryStore,
    prefix: string,
  ) {
    this.prefix = prefix;
  }

  init(options: Parameters<NonNullable<Store['init']>>[0]): void {
    this.redisStore.init(options);
    this.memoryStore.init(options);
  }

  async get(key: string) {
    try {
      return await this.redisStore.get(key);
    } catch (error) {
      noteRedisRateLimitError(error);
      return this.memoryStore.get(key);
    }
  }

  async increment(key: string) {
    try {
      return await this.redisStore.increment(key);
    } catch (error) {
      noteRedisRateLimitError(error);
      return this.memoryStore.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.redisStore.decrement(key);
    } catch (error) {
      noteRedisRateLimitError(error);
      await this.memoryStore.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.memoryStore.resetKey(key);
    try {
      await this.redisStore.resetKey(key);
    } catch (error) {
      noteRedisRateLimitError(error);
    }
  }

  shutdown(): void {
    // RedisStore does not own the shared client and has no shutdown hook.
    // MemoryStore's window timer is the one that would leak.
    this.memoryStore.shutdown();
  }
}

function createRedisStore(redis: RateLimitRedis, prefix: string): RedisMemoryFallbackStore {
  const redisStore = new RedisStore({
    prefix,
    sendCommand: (...command: string[]) => sendRedisCommand(redis, command),
  });
  // SCRIPT LOAD starts in the constructor. A rejected promise with no handler
  // crashes Node, which would take the API down whenever Redis is down.
  void redisStore.incrementScriptSha.catch(() => undefined);
  void redisStore.getScriptSha.catch(() => undefined);
  return new RedisMemoryFallbackStore(redisStore, new MemoryStore(), prefix);
}

/** trim + lowercase. Email and username keys share this form. */
export function normalizeAuthAccount(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * HMAC-SHA256 of the normalized account when `JWT_SECRET` is set, otherwise
 * plain SHA256. The Redis key and logs store only this digest.
 */
export function authAccountKey(account: string): string {
  const normalized = normalizeAuthAccount(account);
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return createHmac('sha256', secret).update(normalized).digest('hex');
  return createHash('sha256').update(normalized).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isBatchRequest(req: { originalUrl?: string; url?: string; query?: unknown }): boolean {
  const url = req.originalUrl ?? req.url ?? '';
  if (/(?:[?&])batch=1(?:&|$)/.test(url)) return true;
  const query = asRecord(req.query);
  return query?.batch === '1';
}

function procedureInput(
  body: unknown,
  index: number,
  batched: boolean,
): Record<string, unknown> | undefined {
  const record = asRecord(body);
  if (!record) return undefined;
  if (!batched) return asRecord(record.json) ?? record;
  const slot = asRecord(record[String(index)]);
  if (!slot) return undefined;
  return asRecord(slot.json) ?? slot;
}

/**
 * Normalized login identifier. Missing means this request is not a login
 * attempt with an account, and the account limiter skips it.
 * Accepts the raw JSON body used by curl and the tRPC batch body
 * `{"0":{"identifier":"..."}}` used by the web client.
 */
export function readAuthAccount(req: {
  originalUrl?: string;
  url?: string;
  query?: unknown;
  body?: unknown;
}): string | undefined {
  const paths = getTrpcPaths(req);
  const index = paths.findIndex((path) => path?.includes('auth.login'));
  if (index < 0) return undefined;
  const batched = isBatchRequest(req) || paths.length > 1;
  const raw = procedureInput(req.body, index, batched)?.identifier;
  if (typeof raw !== 'string') return undefined;
  const normalized = normalizeAuthAccount(raw);
  return normalized.length > 0 ? normalized : undefined;
}

export const CLEAR_LOGIN_ACCOUNT_LIMIT = 'clearLoginAccountLimit';

export type ClearLoginAccountLimit = (identifier: string) => Promise<void>;

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
          // The fallback store swallows Redis errors. If it still throws, fail
          // the request instead of letting the write through.
          passOnStoreError: false,
          logger: redisStoreLogger,
          store: createRedisStore(redis, rateLimitStorePrefix(name, keyPrefix)),
        }),
      };
    },
  );
}

export type AuthAccountLimiter = {
  middleware: RequestHandler;
  clear: ClearLoginAccountLimit;
};

/**
 * Same window and limit as the login IP limiter, including test overrides.
 * The key is only the account hash, so a new client IP does not reset it.
 */
export function createAuthAccountLimiter(
  redis: RateLimitRedis,
  overrides: RateLimitOverrides = {},
  keyPrefix: string = defaultRateLimitPrefix(),
): AuthAccountLimiter {
  const config = productionRateLimitConfigs.authMutation;
  const windowMs = overrides.authMutation?.windowMs ?? config.windowMs;
  const limit = overrides.authMutation?.limit ?? config.limit;
  const store = createRedisStore(redis, `${keyPrefix}authAccount:`);
  const middleware = rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Must not read req.ip. express-rate-limit rejects a key generator that
    // touches the IP without ipKeyGenerator, and this bucket is not per IP.
    keyGenerator: (req) => authAccountKey(readAuthAccount(req) ?? ''),
    skip: (req) => readAuthAccount(req) === undefined,
    handler: trpcRateLimitHandler,
    passOnStoreError: false,
    logger: redisStoreLogger,
    store,
  });
  const clear: ClearLoginAccountLimit = async (identifier) => {
    const normalized = normalizeAuthAccount(identifier);
    if (!normalized) return;
    await store.resetKey(authAccountKey(normalized));
  };
  return { middleware, clear };
}
