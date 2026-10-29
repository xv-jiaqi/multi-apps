import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ZodType } from 'zod';
import { reportCacheStatus } from './cache-header';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Reconnect purge target. Matches `PRODUCTION_CACHE_PREFIX` and nothing under `cardhub:rl:`. */
export const CACHE_PURGE_PREFIX = 'cardhub:cache:v1:';

const PURGE_RETRY_BASE_MS = 200;
const PURGE_RETRY_MAX_MS = 30_000;
export const PURGE_RETRY_ATTEMPT_CAP = 6;

/** Delay after `failureCount` failed purges. The delay stops growing at 30s. */
export function purgeRetryDelayMs(failureCount: number): number {
  if (!Number.isInteger(failureCount) || failureCount < 0) return PURGE_RETRY_BASE_MS;
  const shift = Math.min(failureCount, 16);
  return Math.min(PURGE_RETRY_BASE_MS * 2 ** shift, PURGE_RETRY_MAX_MS);
}

export function purgeRetryScheduled(failureCount: number): boolean {
  return failureCount < PURGE_RETRY_ATTEMPT_CAP;
}

const CONNECT_WAIT_MS = 1_000;

/**
 * One in-flight Redis command. A socket that is still `ready` but no longer
 * answers used to block for `connectTimeout` (1s). Rate-limit reloads its
 * script after that failure, so one request waited about 2s. 200ms keeps the
 * request on the degraded path.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 200;

function readRedisHost(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return 'localhost';
}

function readRedisPort(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const port = Number(value);
    if (port >= 1 && port <= 65535) return port;
  }
  return 6379;
}

function readRedisPassword(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * `ConfigModule.forRoot` copies `process.env` once, when `AppModule` is first
 * evaluated, and every later Nest app in the process reuses that object.
 * A test that points `REDIS_PORT` at a closed port after that snapshot would
 * still dial the original server. Prefer the live environment so the client
 * connects to the address this process is configured to use right now.
 */
function redisSetting(config: ConfigService, key: string): unknown {
  const live = process.env[key];
  if (live !== undefined) return live;
  return config.get<unknown>(key);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private outage = 0;
  private purged = 0;
  private purging = false;
  private closing = false;
  private purgeFailures = 0;
  private purgeGaveUp = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Skip further commands until this time after Redis stops answering. */
  private unavailableUntil = 0;

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {
    client.on('error', (err: Error) => this.logger.warn(`Redis error: ${err.message}`));
    client.on('connect', () => this.logger.log('Redis connected'));
    client.on('close', () => this.noteOutage());
    client.on('end', () => this.noteOutage());
    client.on('ready', () => {
      this.unavailableUntil = 0;
      void this.purgeIfNeeded();
    });
  }

  static createClient(config: ConfigService): Redis {
    const password = readRedisPassword(redisSetting(config, 'REDIS_PASSWORD'));
    return new Redis({
      host: readRedisHost(redisSetting(config, 'REDIS_HOST')),
      port: readRedisPort(redisSetting(config, 'REDIS_PORT')),
      ...(password ? { password } : {}),
      lazyConnect: true,
      connectTimeout: CONNECT_WAIT_MS,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy(times: number): number {
        return Math.min(times * 200, 2_000);
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.becomeReady(CONNECT_WAIT_MS);
  }

  /**
   * Return a cached JSON value, or run `loader` and store it.
   * Redis errors, corrupt payloads, and schema mismatches fall through to
   * `loader`. A loader rejection is not cached.
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    schema: ZodType<T>,
    loader: () => Promise<T>,
  ): Promise<T> {
    if (this.shouldBypass()) {
      reportCacheStatus('BYPASS');
      return loader();
    }

    const cached = await this.readValid(key, schema);
    if (cached.failed) {
      reportCacheStatus('BYPASS');
      return loader();
    }
    if (cached.value !== undefined) {
      reportCacheStatus('HIT');
      return cached.value;
    }

    const fresh = await loader();
    const parsed = schema.safeParse(fresh);
    if (!parsed.success) {
      this.logger.warn(`cache skipped write; payload did not match schema for ${key}`);
      reportCacheStatus('MISS');
      return fresh;
    }
    await this.writeValue(key, parsed.data, ttlSeconds);
    reportCacheStatus('MISS');
    return parsed.data;
  }

  async deleteKeys(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logger.warn(`cache delete failed: ${error instanceof Error ? error.message : ''}`);
      this.noteOutage();
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const scanned = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        const next = scanned[0];
        const found = scanned[1];
        if (next === undefined || found === undefined) {
          throw new Error('redis scan reply was incomplete');
        }
        if (found.length > 0) await this.client.del(...found);
        cursor = next;
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(
        `cache prefix delete failed: ${error instanceof Error ? error.message : ''}`,
      );
      this.noteOutage();
    }
  }

  /** Raw command for the rate-limit store. Callers handle connection errors. */
  async sendCommand(args: readonly string[]): Promise<unknown> {
    const command = args[0];
    if (command === undefined) throw new Error('Redis command is missing');
    if (this.redisCommandsPaused()) throw new Error('redis unavailable');
    try {
      return await this.client.call(command, ...args.slice(1));
    } catch (error) {
      this.noteCommandFailure(error);
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.client.disconnect();
  }

  private redisCommandsPaused(): boolean {
    return this.client.status !== 'ready' || Date.now() < this.unavailableUntil;
  }

  /**
   * A Redis reply such as NOSCRIPT is not an outage: the rate-limit store
   * reloads its script and tries once more. A timeout or a dead socket is.
   * Pausing the next command keeps that retry from waiting out another timeout.
   */
  private noteCommandFailure(error: unknown): void {
    if (error instanceof Error && error.name === 'ReplyError') return;
    this.unavailableUntil = Date.now() + REDIS_COMMAND_TIMEOUT_MS;
  }

  /**
   * A failed invalidation or a dropped connection means catalog keys may now
   * be older than the database. The next ready connection deletes
   * `cardhub:cache:v1:*` and leaves rate-limit keys alone. Failures stay
   * inside this method so callers still return their normal responses.
   */
  private noteOutage(): void {
    if (this.closing) return;
    this.outage += 1;
    if (this.purgeGaveUp) {
      this.purgeFailures = 0;
      this.purgeGaveUp = false;
    }
    void this.purgeIfNeeded();
  }

  private shouldBypass(): boolean {
    return this.purging || this.outage !== this.purged;
  }

  private async purgeIfNeeded(): Promise<void> {
    if (this.closing || this.purging || this.outage === this.purged) return;
    if (this.client.status !== 'ready') return;
    const target = this.outage;
    this.purging = true;
    try {
      await this.unlinkByPrefix(CACHE_PURGE_PREFIX);
      if (this.outage === target) {
        this.purged = target;
        this.purgeFailures = 0;
        this.purgeGaveUp = false;
      }
    } catch (error) {
      this.logger.warn(`cache purge failed: ${error instanceof Error ? error.message : ''}`);
    } finally {
      this.purging = false;
      if (!this.closing && this.outage !== this.purged && this.client.status === 'ready') {
        this.armPurgeRetry();
      }
    }
  }

  private armPurgeRetry(): void {
    if (this.retryTimer !== undefined || this.closing) return;
    if (!purgeRetryScheduled(this.purgeFailures)) {
      if (!this.purgeGaveUp) {
        this.purgeGaveUp = true;
        this.logger.warn(`cache purge stopped after ${PURGE_RETRY_ATTEMPT_CAP} failures`);
      }
      return;
    }
    const delay = purgeRetryDelayMs(this.purgeFailures);
    this.purgeFailures += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.purgeIfNeeded();
    }, delay);
    this.retryTimer.unref();
  }

  private async unlinkByPrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const scanned = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      const next = scanned[0];
      const found = scanned[1];
      if (next === undefined || found === undefined) {
        throw new Error('redis scan reply was incomplete');
      }
      const keys = found.filter((key) => key.startsWith(prefix) && !key.startsWith('cardhub:rl:'));
      if (keys.length > 0) await this.client.unlink(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  private becomeReady(timeoutMs: number): Promise<void> {
    if (this.client.status === 'ready') return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.client.off('ready', onReady);
        clearTimeout(timer);
        resolve();
      };
      const onReady = () => finish();
      const timer = setTimeout(finish, timeoutMs);
      this.client.on('ready', onReady);
      if (this.client.status === 'ready') {
        finish();
        return;
      }
      if (this.client.status === 'wait') {
        void this.client
          .connect()
          .then(finish)
          .catch(() => undefined);
      }
    });
  }

  private async readValid<T>(
    key: string,
    schema: ZodType<T>,
  ): Promise<{ value?: T; failed: boolean }> {
    try {
      const raw = await this.client.get(key);
      if (raw === null) return { failed: false };
      const parsed = schema.safeParse(parseJson(raw));
      return parsed.success ? { value: parsed.data, failed: false } : { failed: false };
    } catch {
      return { failed: true };
    }
  }

  private async writeValue(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`cache write failed: ${error instanceof Error ? error.message : ''}`);
    }
  }
}
