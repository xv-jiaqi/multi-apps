import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  createDefaultConfig,
  hubConfigSchema,
  type HubConfig,
  type HubConfigInput,
} from '@agent-hub/contract';
import type { HubPaths } from '../common/paths';
import { ApiError, parseInput, toIssues } from '../api/api-error';

@Injectable()
export class HubConfigService {
  private config!: HubConfig;
  private readonly listeners = new Set<(config: HubConfig) => void>();

  constructor(private readonly paths: HubPaths) {}

  /** 启动时调用：不存在则写默认；非法则抛 CONFIG_INVALID。 */
  loadOrCreate(): HubConfig {
    mkdirSync(dirname(this.paths.config), { recursive: true, mode: 0o700 });
    try {
      const raw = readFileSync(this.paths.config, 'utf8');
      const parsed = hubConfigSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        const issues = toIssues(parsed.error)
          .slice(0, 5)
          .map((i) => `${i.path || '(root)'}: ${i.message}`)
          .join('; ');
        throw new ApiError('CONFIG_INVALID', `配置不合法：${issues}`, {
          issues: toIssues(parsed.error),
        });
      }
      this.config = parsed.data;
      return this.config;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.config = createDefaultConfig();
        this.writeAtomic(this.config);
        return this.config;
      }
      if (err instanceof ApiError) throw err;
      if (err instanceof SyntaxError) {
        throw new ApiError('CONFIG_INVALID', `配置不是合法 JSON：${err.message}`);
      }
      throw err;
    }
  }

  get(): HubConfig {
    return this.config;
  }

  replace(input: HubConfigInput): HubConfig {
    const next = parseInput(hubConfigSchema, input, 'CONFIG_INVALID');
    this.writeAtomic(next);
    this.config = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  onChange(listener: (config: HubConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private writeAtomic(config: HubConfig): void {
    const tmp = `${this.paths.config}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.paths.config);
  }
}
