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

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const CONNECT_WAIT_MS = 1_000;

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

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {
    client.on('error', (err: Error) => this.logger.warn(`Redis error: ${err.message}`));
    client.on('connect', () => this.logger.log('Redis connected'));
  }

  static createClient(config: ConfigService): Redis {
    const password = readRedisPassword(redisSetting(config, 'REDIS_PASSWORD'));
    return new Redis({
      host: readRedisHost(redisSetting(config, 'REDIS_HOST')),
      port: readRedisPort(redisSetting(config, 'REDIS_PORT')),
      ...(password ? { password } : {}),
      lazyConnect: true,
      connectTimeout: CONNECT_WAIT_MS,
      commandTimeout: CONNECT_WAIT_MS,
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
    const cached = await this.readValid(key, schema);
    if (cached !== undefined) return cached;

    const fresh = await loader();
    const parsed = schema.safeParse(fresh);
    if (!parsed.success) {
      this.logger.warn(`cache skipped write; payload did not match schema for ${key}`);
      return fresh;
    }
    await this.writeValue(key, parsed.data, ttlSeconds);
    return parsed.data;
  }

  async deleteKeys(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (error) {
      this.logger.warn(`cache delete failed: ${error instanceof Error ? error.message : ''}`);
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const scanned = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        const next = scanned[0];
        const found = scanned[1];
        if (next === undefined || found === undefined) return;
        if (found.length > 0) await this.client.del(...found);
        cursor = next;
      } while (cursor !== '0');
    } catch (error) {
      this.logger.warn(
        `cache prefix delete failed: ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  /** Raw command for the rate-limit store. Callers handle connection errors. */
  async sendCommand(args: readonly string[]): Promise<unknown> {
    const command = args[0];
    if (command === undefined) throw new Error('Redis command is missing');
    return this.client.call(command, ...args.slice(1));
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
    this.client.disconnect();
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

  private async readValid<T>(key: string, schema: ZodType<T>): Promise<T | undefined> {
    try {
      const raw = await this.client.get(key);
      if (raw === null) return undefined;
      const parsed = schema.safeParse(parseJson(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
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
