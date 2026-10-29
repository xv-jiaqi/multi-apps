import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator, MemoryStore, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { APP_ERROR_CODES, t } from '@repo/shared';

type TrpcCallRequest = {
  path?: string;
  originalUrl?: string;
  url?: string;
  query?: unknown;
};

type RateLimitConfig = {
  windowMs: number;
  limit: number;
  skip: (req: TrpcCallRequest) => boolean;
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

/**
 * Procedures the auth IP limiter counts. A batch with more than one of these
 * is rejected before any procedure runs.
 */
const AUTH_WRITE_PROCEDURES = new Set(['auth.register', 'auth.login', 'auth.changePassword']);

/**
 * Same-tick query batch measured on the authenticated /me page:
 * auth.me, users.me, listings.mine, users.myTopics, users.myComments,
 * collection.progress, collection.list (7). Login, register, and
 * changePassword are each one mutation. The miniapp client does not batch.
 * 10 sits above that maximum. tRPC rejects a larger batch only when this
 * is also passed to createExpressMiddleware.
 */
export const TRPC_MAX_BATCH_SIZE = 10;

/** In-process fallback entries. A full window refuses new keys instead of evicting. */
export const MEMORY_FALLBACK_MAX_ENTRIES = 100_000;

/** Label mixed into the JWT secret before it is used as an account-key HMAC key. */
export const AUTH_ACCOUNT_KEY_LABEL = 'rl:authAccount:v1';

export type ParsedTrpcProcedures =
  | { ok: true; procedures: string[]; batch: boolean }
  | { ok: false };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * `batch=1` is the only case where tRPC splits the path. The value is the
 * first query entry, matching `URLSearchParams.get`.
 */
function isBatchCall(req: TrpcCallRequest): boolean {
  const query = asRecord(req.query);
  if (query && Object.prototype.hasOwnProperty.call(query, 'batch')) {
    const value = query.batch;
    const first = Array.isArray(value) ? value[0] : value;
    return first === '1';
  }
  const raw = req.originalUrl ?? req.url ?? '';
  const queryIndex = raw.indexOf('?');
  if (queryIndex < 0) return false;
  return new URLSearchParams(raw.slice(queryIndex + 1)).get('batch') === '1';
}

/**
 * Procedure segment tRPC's Express adapter passes in: the last `/` piece of
 * `req.path` (Express 5 leaves percent-encoding in place). Callers that only
 * have a URL string use the same last piece.
 */
function procedureSegment(req: TrpcCallRequest): string {
  const source =
    typeof req.path === 'string' ? req.path : (req.originalUrl ?? req.url ?? '').split('?')[0];
  return (source ?? '').slice((source ?? '').lastIndexOf('/') + 1);
}

/**
 * tRPC decodes the whole procedure segment, then splits on comma only for a
 * batch call. A bad escape is a failed parse, not a procedure name.
 */
export function parseTrpcProcedures(req: TrpcCallRequest): ParsedTrpcProcedures {
  let decoded: string;
  try {
    decoded = decodeURIComponent(procedureSegment(req));
  } catch (error) {
    if (error instanceof URIError) return { ok: false };
    throw error;
  }
  const batch = isBatchCall(req);
  return { ok: true, procedures: batch ? decoded.split(',') : [decoded], batch };
}

export type TrpcCallRejection = 'decode' | 'batch-size' | 'auth-writes';

/** Shared by the pre-procedure 400 and the auth rate-limit skip / account key. */
export function trpcCallRejection(req: TrpcCallRequest): TrpcCallRejection | undefined {
  const parsed = parseTrpcProcedures(req);
  if (!parsed.ok) return 'decode';
  if (parsed.batch && parsed.procedures.length > TRPC_MAX_BATCH_SIZE) return 'batch-size';
  let authWrites = 0;
  for (const name of parsed.procedures) {
    if (AUTH_WRITE_PROCEDURES.has(name)) authWrites += 1;
  }
  if (authWrites > 1) return 'auth-writes';
  return undefined;
}

const TRPC_BAD_REQUEST = {
  error: {
    message: t('zh-CN', 'error.app.BAD_REQUEST'),
    code: -32600,
    data: {
      code: 'BAD_REQUEST',
      appCode: APP_ERROR_CODES.BAD_REQUEST,
      httpStatus: 400,
    },
  },
};

/**
 * Runs before rate limiters and before tRPC. A bad procedure path, a batch
 * over {@link TRPC_MAX_BATCH_SIZE}, or more than one auth-write slot is a
 * 400 and does not execute or count any procedure.
 */
export function rejectInvalidTrpcCall(): RequestHandler {
  return (req, res, next) => {
    if (trpcCallRejection(req) === undefined) {
      next();
      return;
    }
    res.status(400).type('application/json').send(TRPC_BAD_REQUEST);
  };
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
  const parsed = parseTrpcProcedures(req);
  if (!parsed.ok) {
    res.status(429).type('application/json').send(trpcTooManyRequestsError(undefined));
    return;
  }
  const payload = parsed.batch
    ? parsed.procedures.map((path) => trpcTooManyRequestsError(path || undefined))
    : trpcTooManyRequestsError(parsed.procedures[0] || undefined);

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
// The window matches authMutation (60s, 10). There is no lock longer than
// that window. A successful login below the limit deletes the key. The
// limiter runs before the procedure, so the request that crosses the limit
// is 429 before the password is checked.
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
  return new RedisMemoryFallbackStore(redisStore, new CappedMemoryStore(), prefix);
}

/**
 * MemoryStore already drops untouched keys after two windows. This cap
 * refuses a new key once the live maps are full, so a client rotating keys
 * cannot grow the process without bound. Existing keys still increment.
 * Evicting an old key would let that rotation skip a counter that is still
 * inside the window.
 */
export class CappedMemoryStore extends MemoryStore {
  constructor(private readonly maxEntries: number = MEMORY_FALLBACK_MAX_ENTRIES) {
    super();
  }

  override async increment(key: string) {
    const known = this.current.has(key) || this.previous.has(key);
    if (!known && this.current.size + this.previous.size >= this.maxEntries) {
      return {
        totalHits: Number.MAX_SAFE_INTEGER,
        resetTime: new Date(Date.now() + this.windowMs),
      };
    }
    return super.increment(key);
  }
}

/** trim + lowercase. Email and username keys share this form. */
export function normalizeAuthAccount(value: string): string {
  return value.trim().toLowerCase();
}

/** Startup fails when this is empty. The raw secret is not the HMAC key. */
export function authAccountKeySecret(): string {
  const secret = process.env.JWT_SECRET?.trim() ?? '';
  if (!secret) {
    throw new Error('JWT_SECRET is required to derive auth account rate-limit keys');
  }
  return secret;
}

function authAccountHmacKey(): Buffer {
  return createHmac('sha256', authAccountKeySecret()).update(AUTH_ACCOUNT_KEY_LABEL).digest();
}

/**
 * HMAC-SHA256 of the normalized account under a key derived from JWT_SECRET.
 * The Redis key and logs store only this digest.
 */
export function authAccountKey(account: string): string {
  const normalized = normalizeAuthAccount(account);
  return createHmac('sha256', authAccountHmacKey()).update(normalized).digest('hex');
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
export function readAuthAccount(
  req: TrpcCallRequest & {
    body?: unknown;
  },
): string | undefined {
  const parsed = parseTrpcProcedures(req);
  if (!parsed.ok) return undefined;
  const index = parsed.procedures.indexOf('auth.login');
  if (index < 0) return undefined;
  const raw = procedureInput(req.body, index, parsed.batch)?.identifier;
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
      const parsed = parseTrpcProcedures(req);
      if (!parsed.ok) return true;
      return !parsed.procedures.some((name) => AUTH_WRITE_PROCEDURES.has(name));
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
  authAccountKeySecret();
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
