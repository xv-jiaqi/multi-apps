import { Inject, Injectable } from '@nestjs/common';
import type { AgentCapabilities, AgentConfig, AgentDto, AgentHealth } from '@agent-hub/contract';
import { CodexAdapter } from '../adapters/codex/codex-adapter';
import type { AdapterDeps, AgentAdapter, ProcessSupervisor } from '../adapters/types';
import type { HubLogger } from '../common/logger';
import { HUB_LOGGER, PROCESS_SUPERVISOR, GIT_GUARD } from '../common/tokens';
import { HubConfigService } from '../config/config.service';
import { SERVER_VERSION } from '../version';
import type { GitGuard } from '../workspace/git-guard';
import { HUB_PATHS, type HubPaths } from '../common/paths';
import { join } from 'node:path';

interface Entry {
  config: AgentConfig;
  adapter: AgentAdapter | null;
  health: AgentHealth;
  caps: AgentCapabilities | null;
}

/** 按 config.agents 建适配器。本期只有 Codex；ACP（PR3）与网页 Agent 报 unavailable。 */
@Injectable()
export class AdapterRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly config: HubConfigService,
    @Inject(PROCESS_SUPERVISOR) private readonly supervisor: ProcessSupervisor,
    @Inject(GIT_GUARD) private readonly guard: GitGuard,
    @Inject(HUB_LOGGER) private readonly logger: HubLogger,
    @Inject(HUB_PATHS) private readonly paths: HubPaths,
  ) {
    this.rebuild();
  }

  rebuild(): void {
    for (const agent of this.config.get().agents) {
      if (this.entries.has(agent.id)) continue;
      const entry: Entry = {
        config: agent,
        adapter: null,
        health: { status: 'checking' },
        caps: null,
      };
      if (!agent.enabled) entry.health = { status: 'disabled' };
      else if (agent.kind === 'codex') entry.adapter = new CodexAdapter(agent, this.depsFor(entry));
      else {
        entry.health = {
          status: 'unavailable',
          code: 'AGENT_DISABLED',
          message: agent.kind === 'acp' ? '本版本尚未接入 ACP 适配器' : '本版本尚未接入网页 Agent',
        };
      }
      this.entries.set(agent.id, entry);
    }
  }

  get(
    agentId: string,
  ): { config: AgentConfig; adapter: AgentAdapter | null; health: AgentHealth } | null {
    return this.entries.get(agentId) ?? null;
  }

  async probe(agentId: string): Promise<void> {
    const e = this.entries.get(agentId);
    if (!e?.adapter) return;
    const r = await e.adapter.probe();
    e.health = r.health;
    e.caps = r.capabilities;
  }

  probeAll(): Promise<void[]> {
    return Promise.all([...this.entries.keys()].map((id) => this.probe(id)));
  }

  dto(agentId: string, counts: { running: number; queued: number }): AgentDto | null {
    const e = this.entries.get(agentId);
    if (!e) return null;
    return {
      id: e.config.id,
      displayName: e.config.displayName,
      kind: e.config.kind,
      profile: e.config.kind === 'acp' ? e.config.profile : null,
      enabled: e.config.enabled,
      health: e.health,
      capabilities: e.caps ?? e.adapter?.capabilities() ?? null,
      maxConcurrentTasks: e.config.maxConcurrentTasks,
      runningTasks: counts.running,
      queuedTasks: counts.queued,
    };
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => e.adapter?.shutdown()));
  }

  private depsFor(entry: Entry): AdapterDeps {
    return {
      supervisor: this.supervisor,
      logger: {
        debug: (m, meta) => this.logger.debug?.(m, { scope: 'adapter', ...meta }),
        info: (m, meta) => this.logger.info(m, { scope: 'adapter', ...meta }),
        warn: (m, meta) => this.logger.warn(m, { scope: 'adapter', ...meta }),
        error: (m, meta) => this.logger.errorMsg(m, { scope: 'adapter', ...meta }),
      },
      report: {
        health: (h) => (entry.health = h),
        capabilities: (c) => (entry.caps = c),
      },
      agentEnv: () => this.guard.agentEnv(entry.config.envPassthrough),
      now: () => new Date(),
      hubVersion: SERVER_VERSION,
      probeCwd: join(this.paths.home, 'probe'),
    };
  }
}
