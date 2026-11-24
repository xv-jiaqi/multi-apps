import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LoggerService } from '@nestjs/common';
import type { HubPaths } from './paths';
import { redact, redactDeep } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class HubLogger implements LoggerService {
  private minLevel: LogLevel = 'info';

  constructor(private readonly paths: HubPaths) {
    mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', String(message), this.meta(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', String(message), this.meta(optionalParams));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', String(message), this.meta(optionalParams));
  }

  debug?(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', String(message), this.meta(optionalParams));
  }

  verbose?(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', String(message), this.meta(optionalParams));
  }

  info(msg: string, meta: Record<string, unknown> = {}): void {
    this.write('info', msg, meta);
  }

  errorMsg(msg: string, meta: Record<string, unknown> = {}): void {
    this.write('error', msg, meta);
  }

  private meta(optionalParams: unknown[]): Record<string, unknown> {
    const last = optionalParams[optionalParams.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      return last as Record<string, unknown>;
    }
    if (typeof last === 'string') return { scope: last };
    return {};
  }

  private write(level: LogLevel, msg: string, meta: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const safeMeta = redactDeep(meta) as Record<string, unknown>;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope: typeof safeMeta.scope === 'string' ? safeMeta.scope : 'server',
      msg: redact(msg),
      ...safeMeta,
    });
    const day = new Date().toISOString().slice(0, 10);
    const file = join(this.paths.logs, `server-${day}.log`);
    try {
      appendFileSync(file, `${line}\n`, { mode: 0o600 });
    } catch {
      // ignore log write failures
    }
    if (level === 'warn' || level === 'error') {
      process.stderr.write(`${line}\n`);
    }
  }
}
