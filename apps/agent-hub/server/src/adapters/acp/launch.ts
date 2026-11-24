import type { AcpAgentConfig, AgentError } from '@agent-hub/contract';
import {
  JsonRpcConnection,
  JsonRpcError,
  JsonRpcTimeoutError,
  type NotificationHandler,
  type RequestHandler,
} from '../jsonrpc/connection';
import {
  AgentFailure,
  agentError,
  toJsonValue,
  type AdapterDeps,
  type ManagedProcess,
} from '../types';
import { acpErrorText, agentInfoFrom, type AcpAgentInfo, type AcpNames } from './mapping';
import {
  ACP_CLIENT_CAPABILITIES,
  ACP_PROTOCOL_VERSION,
  acpRequest,
  type InitializeResponse,
} from './protocol';

export const ACP_HANDSHAKE_TIMEOUT_MS = 30_000;

export interface LaunchAcpInput {
  config: AcpAgentConfig;
  deps: AdapterDeps;
  names: AcpNames;
  cwd: string;
  /** "acp:<agentId>:<shortId>"，探测时 "acp:<agentId>:probe"。 */
  label: string;
  taskId: string | null;
  /** 在 initialize 之前挂上：Agent 可能在握手响应前后就发来消息。 */
  onNotification: NotificationHandler;
  onRequest: RequestHandler;
  onRaw(direction: 'in' | 'out', line: string): void;
}

export interface AcpProcess {
  managed: ManagedProcess;
  conn: JsonRpcConnection;
  init: InitializeResponse;
  info: AcpAgentInfo;
  executablePath: string;
}

/** §4.1：解析命令 → 启动 → 建连接 → initialize。失败时进程已结束，抛 AgentFailure。 */
export async function launchAcp(input: LaunchAcpInput): Promise<AcpProcess> {
  const { config, deps, names } = input;
  const executablePath = await deps.supervisor.resolveExecutable(config.command);
  if (!executablePath) {
    throw new AgentFailure(
      agentError(
        'AGENT_BINARY_NOT_FOUND',
        `找不到 ${names.displayName} 的命令“${config.command}”：确认已安装，或在设置页填写绝对路径`,
        false,
      ),
    );
  }
  const managed = await deps.supervisor.spawn({
    command: executablePath,
    args: config.args,
    cwd: input.cwd,
    env: deps.agentEnv(),
    label: input.label,
    taskId: input.taskId,
  });
  const conn = new JsonRpcConnection(managed.stdout, managed.stdin, {
    includeJsonrpcField: true,
    onRaw: input.onRaw,
    onInvalidLine: (line) =>
      deps.logger.debug('ACP Agent 输出了非 JSON 行', {
        label: input.label,
        line: line.slice(0, 2000),
      }),
  });
  conn.onNotification(input.onNotification);
  conn.onRequest(input.onRequest);

  let init: InitializeResponse;
  try {
    init = await acpRequest(
      conn,
      'initialize',
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: ACP_CLIENT_CAPABILITIES,
        clientInfo: { name: 'agent_hub', title: 'Agent Hub', version: deps.hubVersion },
      },
      ACP_HANDSHAKE_TIMEOUT_MS,
    );
  } catch (err) {
    throw new AgentFailure(await handshakeError(err, managed, conn, names));
  }
  if (init.protocolVersion !== ACP_PROTOCOL_VERSION) {
    conn.close();
    await managed.terminate();
    throw new AgentFailure(
      agentError(
        'AGENT_PROTOCOL_ERROR',
        `${names.displayName} 使用 ACP 协议版本 ${init.protocolVersion}，Hub 只支持 ${ACP_PROTOCOL_VERSION}`,
        false,
      ),
    );
  }
  return { managed, conn, init, info: agentInfoFrom(init), executablePath };
}

async function handshakeError(
  err: unknown,
  managed: ManagedProcess,
  conn: JsonRpcConnection,
  names: AcpNames,
): Promise<AgentError> {
  conn.close();
  const exit = await managed.terminate();
  if (err instanceof JsonRpcTimeoutError) {
    return agentError(
      'AGENT_HANDSHAKE_TIMEOUT',
      `${names.displayName} 启动后 ${ACP_HANDSHAKE_TIMEOUT_MS / 1000} 秒内没有完成握手`,
      true,
    );
  }
  if (err instanceof JsonRpcError) {
    return agentError(
      'AGENT_PROTOCOL_ERROR',
      `${names.displayName} 握手失败：${acpErrorText(err)}`,
      false,
      toJsonValue({ code: err.code, message: err.message, data: err.data }),
    );
  }
  return agentError(
    'AGENT_SPAWN_FAILED',
    `${names.displayName} 启动后立即退出（退出码 ${exit.code ?? exit.signal ?? '未知'}）`,
    false,
    toJsonValue({ exit, stderrTail: managed.stderrTail() }),
  );
}
