import type {
  AcpAgentConfig,
  AgentCapabilities,
  AgentHealth,
  ModelOption,
} from '@agent-hub/contract';
import { redact } from '../../common/redact';
import { JsonRpcError } from '../jsonrpc/connection';
import { SHUTDOWN_TERMINATE } from '../process/supervisor';
import {
  AgentFailure,
  agentError,
  type AdapterDeps,
  type AgentAdapter,
  type AgentEventSink,
  type AgentSession,
  type ManagedProcess,
  type ProbeResult,
  type StartSessionParams,
} from '../types';
import { AcpSession, type AcpSessionHost } from './acp-session';
import { launchAcp } from './launch';
import {
  classifyAcpError,
  configStateFrom,
  isLoggedOutStatus,
  mapStartError,
  normalizeAcpModels,
  type AcpAgentInfo,
  type AcpConfigState,
  type AcpNames,
} from './mapping';
import { ACP_PROFILES, type AcpProfile } from './profiles';
import { ACP_AUTH_STATUS_METHOD, ACP_ERROR, acpRequest } from './protocol';

const CLOSE_TIMEOUT_MS = 2000;

/** adapter-acp.md §4、§8.4：通用 ACP 适配器，差异都在 profile 里。每个任务一个进程。 */
export class AcpAdapter implements AgentAdapter {
  readonly kind = 'acp' as const;
  readonly profile: AcpProfile;
  readonly names: AcpNames;
  private caps: AgentCapabilities;
  private health: AgentHealth = { status: 'checking' };
  private probing: Promise<ProbeResult> | null = null;
  private probeProcess: ManagedProcess | null = null;
  private readonly sessions = new Set<AcpSession>();
  private shuttingDown = false;

  constructor(
    private readonly config: AcpAgentConfig,
    private readonly deps: AdapterDeps,
  ) {
    this.profile = ACP_PROFILES[config.profile];
    this.names = {
      displayName: config.displayName,
      authHint: this.profile.authHint(config.displayName),
    };
    this.caps = this.emptyCapabilities();
  }

  get id(): string {
    return this.config.id;
  }

  capabilities(): AgentCapabilities {
    return this.caps;
  }

  /** §4.2：同一时刻只跑一个探测。 */
  probe(): Promise<ProbeResult> {
    this.probing ??= this.runProbe().finally(() => (this.probing = null));
    return this.probing;
  }

  private async runProbe(): Promise<ProbeResult> {
    let loggedOut = false;
    try {
      const proc = await launchAcp({
        config: this.config,
        deps: this.deps,
        names: this.names,
        cwd: this.deps.probeCwd,
        label: `acp:${this.config.id}:probe`,
        taskId: null,
        onNotification: (method, params) => {
          if (method === ACP_AUTH_STATUS_METHOD && isLoggedOutStatus(params)) loggedOut = true;
        },
        onRequest: (method) => {
          throw new JsonRpcError(ACP_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
        },
        onRaw: (direction, line) =>
          this.deps.logger.debug('ACP 探测帧', {
            agentId: this.config.id,
            direction,
            line: redact(line.slice(0, 2048)),
          }),
      });
      this.probeProcess = proc.managed;
      let health: AgentHealth;
      try {
        const res = await acpRequest(proc.conn, 'session/new', {
          cwd: this.deps.probeCwd,
          mcpServers: [],
        });
        this.updateCapabilities(configStateFrom(res), proc.info);
        if (proc.info.close) {
          await acpRequest(
            proc.conn,
            'session/close',
            { sessionId: res.sessionId },
            CLOSE_TIMEOUT_MS,
          ).catch(() => undefined);
        }
        health = loggedOut ? this.authHealth(proc.info.version) : this.readyHealth(proc);
      } catch (err) {
        if (err instanceof JsonRpcError && (classifyAcpError(err) === 'auth' || loggedOut)) {
          health = this.authHealth(proc.info.version);
        } else if (err instanceof JsonRpcError) {
          const e = mapStartError(err, this.names, 'new');
          health = { status: 'unavailable', code: e.code, message: e.message };
        } else if (loggedOut) {
          health = this.authHealth(proc.info.version);
        } else {
          health = {
            status: 'unavailable',
            code: 'AGENT_PROTOCOL_ERROR',
            message: `${this.names.displayName} 探测失败：${err instanceof Error ? err.message : String(err)}`,
          };
        }
      } finally {
        proc.conn.close();
        await proc.managed.terminate();
        this.probeProcess = null;
      }
      this.setHealth(health);
    } catch (err) {
      this.setHealth(
        err instanceof AgentFailure
          ? { status: 'unavailable', code: err.error.code, message: err.error.message }
          : {
              status: 'unavailable',
              code: 'AGENT_PROTOCOL_ERROR',
              message: `${this.names.displayName} 探测失败：${err instanceof Error ? err.message : String(err)}`,
            },
      );
    }
    return { health: this.health, capabilities: this.caps };
  }

  async startSession(params: StartSessionParams, sink: AgentEventSink): Promise<AgentSession> {
    if (this.shuttingDown)
      throw new AgentFailure(agentError('HUB_SHUTDOWN', 'Agent Hub 正在退出', true));
    const session = new AcpSession(this.host(), params, sink);
    this.sessions.add(session);
    try {
      await session.open();
    } catch (err) {
      this.sessions.delete(session);
      throw err;
    }
    return session;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const probe = this.probeProcess;
    await Promise.all([
      ...[...this.sessions].map((s) => s.dispose('shutdown')),
      probe ? probe.terminate(SHUTDOWN_TERMINATE) : Promise.resolve(),
    ]);
  }

  private host(): AcpSessionHost {
    return {
      config: this.config,
      deps: this.deps,
      profile: this.profile,
      names: this.names,
      models: () => this.caps.models,
      sessionCreated: (state, info) => this.updateCapabilities(state, info),
      setHealth: (h) => this.setHealth(h),
      healthStatus: () => this.health.status,
      release: (s) => this.sessions.delete(s),
    };
  }

  private updateCapabilities(state: AcpConfigState, info: AcpAgentInfo): void {
    const models: ModelOption[] = normalizeAcpModels(state);
    this.caps = {
      ...this.emptyCapabilities(),
      models,
      resume: info.resume !== null,
      fetchedAt: this.deps.now().toISOString(),
    };
    this.deps.report.capabilities(this.caps);
  }

  private emptyCapabilities(): AgentCapabilities {
    return {
      models: [],
      modelsSource: 'session',
      sandbox: false,
      resume: false,
      userVisibleSessions: false,
      workspaces: ['in_place', 'worktree'],
      fetchedAt: this.deps.now().toISOString(),
    };
  }

  private authHealth(version: string | null): AgentHealth {
    return { status: 'auth_required', message: this.names.authHint, version };
  }

  private readyHealth(proc: { info: AcpAgentInfo; executablePath: string }): AgentHealth {
    const version = proc.info.version;
    return {
      status: 'ready',
      version,
      versionVerified: version !== null && this.profile.verifiedVersions.includes(version),
      executablePath: proc.executablePath,
    };
  }

  private setHealth(h: AgentHealth): void {
    this.health = h;
    this.deps.report.health(h);
  }
}
