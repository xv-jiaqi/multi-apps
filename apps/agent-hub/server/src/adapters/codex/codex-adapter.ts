import { homedir } from 'node:os';
import type {
  AgentCapabilities,
  AgentHealth,
  CodexAgentConfig,
  ModelOption,
} from '@agent-hub/contract';
import { redact } from '../../common/redact';
import {
  JsonRpcClosedError,
  JsonRpcConnection,
  JsonRpcError,
  JsonRpcTimeoutError,
} from '../jsonrpc/connection';
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
import { CodexSession } from './codex-session';
import {
  CODEX_DEVELOPER_INSTRUCTIONS,
  normalizeCodexModels,
  parseCodexVersion,
  sandboxFor,
} from './mapping';
import {
  CODEX_VERIFIED_VERSIONS,
  type CodexModel,
  type GetAccountResponse,
  type InitializeParams,
  type InitializeResponse,
  type ModelListResponse,
  type ThreadResumeParams,
  type ThreadStartParams,
  type ThreadStartResponse,
} from './protocol';

interface Proc {
  managed: ManagedProcess;
  conn: JsonRpcConnection;
  version: string | null;
  versionVerified: boolean;
  executablePath: string;
}

const AUTH_MESSAGE = 'Codex 未登录或登录已过期：请在 ChatGPT 应用或终端里执行 codex login 后重试';

function emptyCapabilities(): AgentCapabilities {
  return {
    models: [],
    modelsSource: 'agent',
    sandbox: true,
    resume: true,
    userVisibleSessions: true,
    workspaces: ['in_place', 'worktree'],
    fetchedAt: new Date(0).toISOString(),
  };
}

/** adapter-codex.md §3–§4、§6、§7.3–§7.4。一个 Codex 配置一个常驻 app-server 进程。 */
export class CodexAdapter implements AgentAdapter {
  readonly kind = 'codex' as const;
  private proc: Proc | null = null;
  private starting: Promise<Proc> | null = null;
  private readonly sessions = new Map<string, CodexSession>();
  private caps: AgentCapabilities = emptyCapabilities();
  private health: AgentHealth = { status: 'checking' };
  private shuttingDown = false;

  constructor(
    private readonly config: CodexAgentConfig,
    private readonly deps: AdapterDeps,
  ) {}

  get id(): string {
    return this.config.id;
  }

  capabilities(): AgentCapabilities {
    return this.caps;
  }

  async probe(): Promise<ProbeResult> {
    try {
      const proc = await this.ensureProcess();
      const account = await proc.conn.request<GetAccountResponse>('account/read', {});
      const all: CodexModel[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const res: ModelListResponse = await proc.conn.request<ModelListResponse>(
          'model/list',
          cursor ? { cursor } : {},
        );
        all.push(...res.data);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      this.caps = {
        ...emptyCapabilities(),
        models: normalizeCodexModels(all),
        fetchedAt: this.deps.now().toISOString(),
      };
      this.deps.report.capabilities(this.caps);
      this.setHealth(
        account.account === null && account.requiresOpenaiAuth
          ? {
              status: 'auth_required',
              message: 'Codex 未登录：请在 ChatGPT 应用或终端里执行 codex login',
              version: proc.version,
            }
          : this.readyHealth(proc),
      );
    } catch (err) {
      this.setHealth(
        err instanceof AgentFailure
          ? { status: 'unavailable', code: err.error.code, message: err.error.message }
          : {
              status: 'unavailable',
              code: 'AGENT_PROTOCOL_ERROR',
              message: `Codex 探测失败：${String(err)}`,
            },
      );
    }
    return { health: this.health, capabilities: this.caps };
  }

  async startSession(params: StartSessionParams, sink: AgentEventSink): Promise<AgentSession> {
    if (this.shuttingDown)
      throw new AgentFailure(agentError('HUB_SHUTDOWN', 'Agent Hub 正在停机', true));
    const proc = await this.ensureProcess();
    const { sandbox } = sandboxFor(params.mode, params.cwd);
    let res: ThreadStartResponse;
    try {
      const account = await proc.conn.request<GetAccountResponse>('account/read', {});
      if (account.account === null && account.requiresOpenaiAuth) {
        this.setHealth({ status: 'auth_required', message: AUTH_MESSAGE, version: proc.version });
        throw new AgentFailure(agentError('AGENT_AUTH_REQUIRED', AUTH_MESSAGE, false));
      }
      if (params.resumeNativeSessionId) {
        const p: ThreadResumeParams = {
          threadId: params.resumeNativeSessionId,
          cwd: params.cwd,
          approvalPolicy: 'on-request',
          sandbox,
          developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS,
          excludeTurns: true,
        };
        try {
          res = await proc.conn.request<ThreadStartResponse>('thread/resume', p);
        } catch (err) {
          if (err instanceof JsonRpcError) {
            throw new AgentFailure(
              agentError('SESSION_NOT_RESUMABLE', `Codex 无法恢复会话：${err.message}`, false, {
                code: err.code,
                message: err.message,
              }),
            );
          }
          throw err;
        }
      } else {
        const p: ThreadStartParams = {
          cwd: params.cwd,
          approvalPolicy: 'on-request',
          sandbox,
          serviceName: 'agent_hub',
          developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS,
          ...(params.userVisible ? { threadSource: 'user' } : {}),
        };
        res = await proc.conn.request<ThreadStartResponse>('thread/start', p);
      }
    } catch (err) {
      throw this.toFailure(err);
    }
    const threadId = res.thread.id;
    const session = new CodexSession(threadId, params.cwd, params.mode, sink, {
      conn: () => (this.proc?.conn.isOpen ? this.proc.conn : null),
      models: () => this.caps.models,
      reportAuthRequired: (message) =>
        this.setHealth({ status: 'auth_required', message, version: this.proc?.version ?? null }),
      release: (id) => this.sessions.delete(id),
      logger: this.deps.logger,
    });
    this.sessions.set(threadId, session);
    if (params.signal.aborted) {
      await session.dispose('cancelled');
      throw new AgentFailure(agentError('HUB_SHUTDOWN', '任务已取消', false));
    }
    sink.emit({
      type: 'session.started',
      nativeSessionId: threadId,
      model: res.model ?? res.thread.model ?? null,
      resumed: params.resumeNativeSessionId !== null,
    });
    if (this.health.status !== 'ready') this.setHealth(this.readyHealth(proc));
    return session;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.sessions.values()].map((s) => s.dispose('shutdown')));
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.conn.close();
      await proc.managed.terminate(SHUTDOWN_TERMINATE);
    }
  }

  // ---- 进程 ----

  private ensureProcess(): Promise<Proc> {
    if (this.proc?.conn.isOpen) return Promise.resolve(this.proc);
    this.starting ??= this.spawnProcess().finally(() => (this.starting = null));
    return this.starting;
  }

  private async spawnProcess(): Promise<Proc> {
    const exe = await this.deps.supervisor.resolveExecutable(this.config.command);
    if (!exe) {
      throw new AgentFailure(
        agentError(
          'AGENT_BINARY_NOT_FOUND',
          `找不到 Codex 命令“${this.config.command}”：确认已安装 Codex CLI，或在设置页填写绝对路径`,
          false,
        ),
      );
    }
    const managed = await this.deps.supervisor.spawn({
      command: exe,
      args: this.config.args,
      cwd: homedir(),
      env: this.deps.agentEnv(),
      label: `codex:${this.config.id}`,
      taskId: null,
    });
    const conn = new JsonRpcConnection(managed.stdout, managed.stdin, {
      includeJsonrpcField: false,
      onInvalidLine: (line) =>
        this.deps.logger.debug('codex 非 JSON-RPC 输出', { line: redact(line.slice(0, 2048)) }),
    });
    conn.onNotification((method, params) => this.onNotification(method, params));
    conn.onRequest((method, params, id) => this.onServerRequest(method, params, id));
    const initParams: InitializeParams = {
      clientInfo: { name: 'agent_hub', title: 'Agent Hub', version: this.deps.hubVersion },
      capabilities: { experimentalApi: false, requestAttestation: false },
    };
    let init: InitializeResponse;
    try {
      init = await conn.request<InitializeResponse>('initialize', initParams, {
        timeoutMs: 30_000,
      });
    } catch (err) {
      conn.close();
      await managed.terminate();
      if (err instanceof JsonRpcTimeoutError) {
        throw new AgentFailure(
          agentError('AGENT_HANDSHAKE_TIMEOUT', 'Codex 握手超时（30 秒）', true),
        );
      }
      if (err instanceof JsonRpcClosedError) {
        const exit = await managed.exited;
        throw new AgentFailure(
          agentError('AGENT_SPAWN_FAILED', 'Codex 进程启动后立即退出', true, {
            code: exit.code,
            signal: exit.signal,
            stderr: redact(managed.stderrTail()),
          }),
        );
      }
      throw new AgentFailure(
        agentError('AGENT_PROTOCOL_ERROR', `Codex 握手失败：${String(err)}`, false),
      );
    }
    conn.notify('initialized');
    const version = parseCodexVersion(init.userAgent);
    const proc: Proc = {
      managed,
      conn,
      version,
      versionVerified:
        version !== null && (CODEX_VERIFIED_VERSIONS as readonly string[]).includes(version),
      executablePath: exe,
    };
    this.proc = proc;
    void managed.exited.then((exit) => this.onProcessExit(proc, exit.code));
    this.deps.logger.info('codex app-server 已启动', {
      pid: managed.pid,
      version,
      executable: exe,
    });
    return proc;
  }

  private onProcessExit(proc: Proc, code: number | null): void {
    if (this.proc !== proc) return;
    proc.conn.close();
    this.proc = null;
    for (const s of [...this.sessions.values()]) void s.dispose('agent_exited');
    if (this.shuttingDown) return;
    this.setHealth({
      status: 'unavailable',
      code: 'AGENT_PROCESS_EXITED',
      message: `Codex 进程已退出（退出码 ${code ?? '无'}），下次使用时自动重启`,
    });
    this.deps.logger.warn('codex app-server 退出', {
      code,
      stderr: redact(proc.managed.stderrTail()),
    });
  }

  private onNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === 'account/updated') {
      void this.probe();
      return;
    }
    const threadId = typeof p.threadId === 'string' ? p.threadId : null;
    if (!threadId) return;
    this.sessions.get(threadId)?.onNotification(method, p);
  }

  private async onServerRequest(
    method: string,
    params: unknown,
    id: string | number,
  ): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    const session = typeof p.threadId === 'string' ? this.sessions.get(p.threadId) : undefined;
    if (session) return session.onServerRequest(method, p, id);
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return { decision: 'decline' };
      case 'item/permissions/requestApproval':
        return { permissions: {}, scope: 'turn' };
      case 'item/tool/requestUserInput':
        return { answers: {} };
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null };
      case 'execCommandApproval':
      case 'applyPatchApproval':
        return { decision: 'abort' };
      default:
        throw new JsonRpcError(-32601, `Method not found: ${method}`);
    }
  }

  private readyHealth(proc: Proc): AgentHealth {
    return {
      status: 'ready',
      version: proc.version,
      versionVerified: proc.versionVerified,
      executablePath: proc.executablePath,
    };
  }

  private setHealth(h: AgentHealth): void {
    this.health = h;
    this.deps.report.health(h);
  }

  private toFailure(err: unknown): AgentFailure {
    if (err instanceof AgentFailure) return err;
    if (err instanceof JsonRpcClosedError) {
      return new AgentFailure(agentError('AGENT_PROCESS_EXITED', 'Codex 进程已退出', true));
    }
    if (err instanceof JsonRpcError) {
      return new AgentFailure(
        agentError('AGENT_PROTOCOL_ERROR', `Codex 返回错误：${err.message}`, false, {
          code: err.code,
          message: err.message,
        }),
      );
    }
    return new AgentFailure(
      agentError('AGENT_PROTOCOL_ERROR', `Codex 请求失败：${String(err)}`, false),
    );
  }
}

export type { ModelOption };
