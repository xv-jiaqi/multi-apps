# 通用 ACP 适配器（Qoder / Claude Code / Gemini CLI）

> 上级文档：[../README.md](../README.md)。接口与通用规则见 [adapter-interface.md](adapter-interface.md)（下文简称“接口”）。ACP（Agent Client Protocol）是编辑器与编程 Agent 之间的开放协议：stdio 上的 JSON-RPC 2.0。Hub 是 ACP 的 **Client**。
>
> 依据：`@agentclientprotocol/sdk` **2.0.2** 的类型；**Qoder CLI 1.1.80**（`qodercli --acp`）、**claude-agent-acp 0.97.0**、**Gemini CLI 0.65.0**（`gemini --acp`）于 2026-10-27 / 28 实测（未登录状态：握手、建会话、切模型 / 推理档位 / 模式、发提示词、恢复、关闭、关 stdin 退出）。`protocol.ts`（§11）、`profiles.ts`（§3）、`launch.ts`（§4.1）、`mapping.ts`（§12）是完整文件，已编译；`mapping.ts` 用实测帧跑过单测，`launch.ts` 用假 Agent 和三个真实 Agent 跑过。四个文件原样复制。

## 1. 概览

| 方面       | 做法                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 传输       | 子进程 stdio，每行一个 JSON-RPC 消息，**带** `"jsonrpc": "2.0"`（接口 §7.2）。协议客户端自己实现，SDK 只用 `import type`（D34）。 |
| 进程       | **每个任务一个**进程（独立进程组，D35）；任务进入终态后闲置 10 分钟结束。                                                         |
| 客户端能力 | 文件读写、终端全部不声明（D36）；只声明 `session.notices`（Agent 才会发 `notice`）。                                              |
| 原生会话   | ACP session；`nativeSessionId` = `sessionId`。一个任务一个 session。                                                              |
| 轮         | 一次 `session/prompt` 请求，响应里的 `stopReason` 结束本轮。ACP 没有 turn id。                                                    |
| 审批       | `session/request_permission`；只选“仅这一次”类选项，没有“本会话允许”（D59，§7）。                                                 |
| 沙箱       | 没有。只读靠**会话模式 + 审批 + 轮后树快照比对**（D37、D38）。                                                                    |
| 模型       | 来自会话返回的配置项（`category: "model"` / `"thought_level"`）或旧的 `models` 字段；每轮发提示词前对齐（§4.5）。                 |
| 恢复       | `session/resume`，Agent 不支持时 `session/load`（§9）。                                                                           |
| 登录       | Hub 不调用 `authenticate`；按错误码、错误文本和 `_auth/status_update` 识别未登录（§2.3，D60）。                                   |

代码文件：

| 文件                                     | 内容                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `server/src/adapters/acp/protocol.ts`    | 协议类型与常量（§11 全文）。                                                                                         |
| `server/src/adapters/acp/profiles.ts`    | 各 Agent 的差异：登录提示、模式偏好、验证过的版本（§3 全文）。                                                       |
| `server/src/adapters/acp/launch.ts`      | `launchAcp()`：解析命令、启动进程、建连接、握手；探测与会话共用（§4.1 全文）。                                       |
| `server/src/adapters/acp/mapping.ts`     | 协议 ↔ Hub 的纯函数：错误分类、配置状态、模型对齐、轮内事件、权限请求（§12 全文）。                                  |
| `server/src/adapters/acp/acp-adapter.ts` | `AcpAdapter implements AgentAdapter`：缓存的能力与健康、探测、建会话、会话表、停机（§4.2、§4.3、§8.4）。按规则实现。 |
| `server/src/adapters/acp/acp-session.ts` | `AcpSession implements AgentSession`：配置状态、模式守卫、轮、权限请求、取消、释放（§4.3–§9）。按规则实现。          |

`AcpAdapter` 的构造参数是 `(config: AcpAgentConfig, deps: AdapterDeps)`；`profile = ACP_PROFILES[config.profile]`，`names = { displayName: config.displayName, authHint: profile.authHint(config.displayName) }`，两者传给 `mapping.ts` 的函数和每个 `AcpSession`。

## 2. 用到的方法

### 2.1 Hub 发出

`AcpRequestMap`（§11）就是 Hub 会发出的全部请求，`acpRequest()` 只接受这些方法名。

| 方法                        | 类型 | 何时                                                            | 超时   | 参数                                                                                                                                                   |
| --------------------------- | ---- | --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `initialize`                | 请求 | 进程启动后第一条                                                | 30 秒  | `{ protocolVersion: 1, clientCapabilities: ACP_CLIENT_CAPABILITIES, clientInfo: { name: "agent_hub", title: "Agent Hub", version: deps.hubVersion } }` |
| `session/new`               | 请求 | 探测；新任务的第一轮                                            | 60 秒  | `{ cwd, mcpServers: [] }`                                                                                                                              |
| `session/resume`            | 请求 | 恢复，Agent 声明了 `sessionCapabilities.resume`                 | 60 秒  | `{ sessionId, cwd, mcpServers: [] }`                                                                                                                   |
| `session/load`              | 请求 | 恢复，Agent 只声明了 `loadSession`                              | 60 秒  | 同上                                                                                                                                                   |
| `session/set_config_option` | 请求 | 切模式（有 `mode` 类配置项时）；每轮对齐模型、推理档位          | 60 秒  | `{ sessionId, configId, value }`                                                                                                                       |
| `session/set_mode`          | 请求 | 切模式（没有 `mode` 类配置项时，Gemini）                        | 60 秒  | `{ sessionId, modeId }`                                                                                                                                |
| `session/set_model`         | 请求 | 每轮对齐模型（只有旧 `models` 字段时，Gemini）                  | 60 秒  | `{ sessionId, modelId }`                                                                                                                               |
| `session/prompt`            | 请求 | 每轮                                                            | 不超时 | `{ sessionId, prompt: [{ type: "text", text }] }`（D25：只有文本）                                                                                     |
| `session/cancel`            | 通知 | `cancelTurn()`、`dispose()` 时有进行中的轮                      | —      | `{ sessionId }`                                                                                                                                        |
| `session/close`             | 请求 | 探测结束、`dispose()`，Agent 声明了 `sessionCapabilities.close` | 2 秒   | `{ sessionId }`；失败只记 `debug` 日志                                                                                                                 |

不用的方法：`authenticate`、`logout`（D60）、`session/list`、`session/delete`、`session/fork`、`session/set_model` 以外的不稳定方法。

### 2.2 Hub 处理的 Agent 消息

| 消息                                             | 类型 | 处理                                                                      |
| ------------------------------------------------ | ---- | ------------------------------------------------------------------------- |
| `session/update`                                 | 通知 | 配置与模式（§4.4、§5，任何时候）；轮内事件（§6.2，只在有进行中的轮时）    |
| `session/request_permission`                     | 请求 | §7                                                                        |
| `$/cancel_request`                               | 通知 | Agent 撤回它发来的请求（§7.4）                                            |
| `_auth/status_update`                            | 通知 | claude-agent-acp 的扩展：`authStatus.kind` 为 `"none"` 表示未登录（§2.3） |
| `fs/*`、`terminal/*`、`elicitation/*` 及其他请求 | 请求 | 回 `-32601`（D36：没有声明这些能力，Agent 不应发来）                      |
| 其他通知                                         | 通知 | 只进 transcript（`sink.raw`）和 `debug` 日志（接口 §3.1 规则 10）         |

### 2.3 未登录的识别

Hub 不调用 `authenticate`：它可能拉起浏览器登录、改 Agent 自己的凭据文件，等于 Hub 接管了登录（D60）。登录由人在终端里完成，Hub 只负责识别并给出 profile 的 `authHint`。

| 信号                                                                                                                       | 出现在                                                                                                                                                                              | 处理                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 错误码 `-32000`、`401`、`403`，或错误文本匹配“authentication required / not logged in / unauthorized / API key 缺失或无效” | Qoder 与 Gemini 的 `session/new`（未登录或没有 API key）；Claude Code 的 `session/prompt`；Gemini 的 `session/prompt`（API key 无效时错误码是 `400`，文本里有 “API key not valid”） | `classifyAcpError()` 归为 `auth` → `AGENT_AUTH_REQUIRED`（`message` = `authHint`，`retryable: false`）；上报健康 `auth_required`                                               |
| `_auth/status_update`，`authStatus.kind === "none"`（`isLoggedOutStatus()`）                                               | claude-agent-acp：未登录时在 `session/new` 的响应**之前**发来（`session/new` 本身照样成功）                                                                                         | 探测：健康 `auth_required`。建会话：`session/new` 成功后仍按未登录失败（§4.3 第 5 步），不等到发提示词才失败。会话建成后再收到：只上报健康 `auth_required`，不影响进行中的轮。 |

健康从 `auth_required` 回到 `ready`：下一次探测成功（用户点“刷新”），或下一次 `startSession` 成功。

## 3. Profile

一个 ACP Agent 配置（`config.agents[]`，`kind: "acp"`）通过 `profile` 字段选一个 profile。profile 只收纳**无法从协议里得知**的差异；能从 `initialize` / `session/new` 的响应里读到的（是否支持恢复、模型列表、模式列表）一律按响应来。

// server/src/adapters/acp/profiles.ts
import type { AcpAgentConfig, TaskMode } from '@agent-hub/contract';

/\*_ 取自配置 schema 的枚举：在 acpAgentSchema.profile 里加了值而这里没加，ACP_PROFILES 编译不过。 _/
export type AcpProfileId = AcpAgentConfig['profile'];

export interface AcpProfile {
id: AcpProfileId;
/** AGENT_AUTH_REQUIRED 的说明，也是健康 auth_required 的文案。 \*/
authHint(displayName: string): string;
/**

- 每种任务模式依次尝试的会话模式 id，取第一个 Agent 提供的作为本会话的目标模式（D37）；
- 一个都没有时不管理模式。
  _/
  modes: Record<TaskMode, readonly string[]>;
  /\*\* 兼容表（§10）里核对过的 agentInfo.version。 _/
  verifiedVersions: readonly string[];
  }

export const ACP_PROFILES: Record<AcpProfileId, AcpProfile> = {
qoder: {
id: 'qoder',
authHint: () => 'Qoder 未登录：请在终端运行 qodercli，按提示登录后重试',
modes: { read_only: ['default'], write: ['default'] },
verifiedVersions: ['1.1.80'],
},
'claude-code': {
id: 'claude-code',
authHint: () => 'Claude Code 未登录：请在终端运行 claude，用 /login 登录后重试',
modes: { read_only: ['plan', 'default'], write: ['default'] },
verifiedVersions: ['0.97.0'],
},
gemini: {
id: 'gemini',
authHint: () =>
'Gemini CLI 未登录：请在终端运行 gemini 完成登录；用 API key 时把 GEMINI_API_KEY 加进该 Agent 的“透传环境变量”',
modes: { read_only: ['plan', 'default'], write: ['default'] },
verifiedVersions: ['0.65.0'],
},
generic: {
id: 'generic',
authHint: (displayName) => `${displayName} 未登录：请先在终端完成该 Agent 的登录`,
modes: { read_only: ['plan', 'default'], write: ['default'] },
verifiedVersions: [],
},
};

| profile       | 预置命令（D39）    | 只读任务的模式                               | 可写任务的模式 | 理由                                                                                                                                                                                                                           |
| ------------- | ------------------ | -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `qoder`       | `qodercli --acp`   | `default`                                    | `default`      | Qoder 的五个模式 `default` / `acceptEdits` / `auto` / `dontAsk` / `yolo` 里只有 `default` 对修改和命令都询问。用户可以在 Qoder 设置里把默认模式（`defaultPermissionMode`）设成 `yolo`，所以 Hub 每个会话都显式切到 `default`。 |
| `claude-code` | `claude-agent-acp` | `plan`（没有时 `default`）                   | `default`      | `plan` 只读规划；`default`（界面名 Manual）修改前询问；`acceptEdits`、`auto`、`bypassPermissions` 会跳过审批。                                                                                                                 |
| `gemini`      | `gemini --acp`     | `plan`（“Read-only mode”，没有时 `default`） | `default`      | `default` 每次询问；`autoEdit`、`yolo` 跳过审批。                                                                                                                                                                              |
| `generic`     | 用户填写           | `plan`，没有时 `default`                     | `default`      | 常见命名。两个都没有时 Hub 不管理模式，只记 `warn` 日志（新建任务对话框照 D38 显示“只读靠审批与快照比对”）。                                                                                                                   |

新增一个 profile：在 `contract/src/config.ts` 的 `acpAgentSchema.profile` 枚举里加 id（`ACP_PROFILES` 的类型取自这个枚举，漏加编译不过），在 `ACP_PROFILES` 里加一项，在 §10 加兼容表行，在 [decisions-and-risks.md](decisions-and-risks.md) 追加决策。**不要**为单个 Agent 复制 `AcpAdapter`。

## 4. 进程与会话

### 4.1 `launchAcp()`

探测和会话都用它启动进程。通知与请求处理器在 `initialize` **之前**挂上：claude-agent-acp 在握手后、建会话响应前就会发 `_auth/status_update`。

// server/src/adapters/acp/launch.ts
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
/** "acp:<agentId>:<shortId>"，探测时 "acp:<agentId>:probe"。 \*/
label: string;
taskId: string | null;
/** 在 initialize 之前挂上：Agent 可能在握手响应前后就发来消息。 \*/
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

/\*_ §4.1：解析命令 → 启动 → 建连接 → initialize。失败时进程已结束，抛 AgentFailure。 _/
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

| 步骤 | 动作                                                                             | 失败                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `resolveExecutable(config.command)`（登录 PATH，接口 §8.1）。                    | `AGENT_BINARY_NOT_FOUND`：“找不到 Qoder 的命令“qodercli”：确认已安装，或在设置页填写绝对路径”                                                                  |
| 2    | `spawn`：`cwd` 由调用方给，环境 `deps.agentEnv()`，独立进程组。                  | `AGENT_SPAWN_FAILED`（supervisor 抛出）                                                                                                                        |
| 3    | 建 `JsonRpcConnection`（带 `jsonrpc` 字段），挂处理器。                          | —                                                                                                                                                              |
| 4    | `initialize`，30 秒。                                                            | 超时 → `AGENT_HANDSHAKE_TIMEOUT`；Agent 返回错误 → `AGENT_PROTOCOL_ERROR`；进程退出 → `AGENT_SPAWN_FAILED`（`detail` 带退出码与 `stderrTail`）。都先结束进程。 |
| 5    | 响应的 `protocolVersion` 必须是 `1`；`agentInfoFrom()` 取版本与恢复 / 关闭能力。 | 版本不对 → `AGENT_PROTOCOL_ERROR`，先结束进程。                                                                                                                |

### 4.2 `probe()`

`AcpAdapter` 同一时刻只跑一个探测（记下进行中的 Promise，重复调用返回它）。

| 步骤 | 动作                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `launchAcp({ cwd: deps.probeCwd, label: "acp:<agentId>:probe", taskId: null })`。通知处理器只认 `_auth/status_update`（记下未登录）；请求处理器一律抛 `JsonRpcError(-32601)`；`onRaw` 截断到 2 KB 记 `debug` 日志。                                                                                                                                   |
| 2    | `session/new { cwd: deps.probeCwd, mcpServers: [] }`。                                                                                                                                                                                                                                                                                                |
| 3    | 结束：`info.close` 为真且第 2 步成功 → `session/close`（2 秒，忽略错误）；`conn.close()`；`managed.terminate()`。无论成败都执行（`finally`）。                                                                                                                                                                                                        |
| 4    | 能力 = `{ models, modelsSource: 'session', sandbox: false, resume: info.resume !== null, userVisibleSessions: false, workspaces: ['in_place', 'worktree'], fetchedAt }`；`models` = 第 2 步成功时 `normalizeAcpModels(configStateFrom(响应))`，否则沿用缓存。                                                                                         |
| 5    | 健康：第 2 步的错误归为 `auth`，或第 1–2 步收到未登录的 `_auth/status_update` → `{ status: 'auth_required', message: names.authHint, version }`；第 2 步其他错误 → `unavailable`（`mapStartError(err, names, 'new')` 的码与说明）；否则 `{ status: 'ready', version, versionVerified: profile.verifiedVersions.includes(version), executablePath }`。 |
| 6    | `launchAcp` 抛 `AgentFailure` → `unavailable`（其码与说明）；其他异常 → `unavailable` + `AGENT_PROTOCOL_ERROR`（“<名称> 探测失败：<message>”）。                                                                                                                                                                                                      |
| 7    | 经 `deps.report` 上报能力与健康并缓存；返回 `{ health, capabilities }`。                                                                                                                                                                                                                                                                              |

构造后、探测完成前，`capabilities()` 返回 `{ models: [], modelsSource: 'session', sandbox: false, resume: false, userVisibleSessions: false, workspaces: ['in_place', 'worktree'], fetchedAt: <构造时间> }`。探测进程的 `cwd` 是 `<AGENT_HUB_HOME>/probe`：侧车启动时创建的空目录（[data-model.md](data-model.md) §1），Agent 可能在里面留下自己的文件，Hub 不读也不清理。

### 4.3 `startSession(params, sink)`

`AcpAdapter.startSession`：正在停机 → 抛 `AgentFailure`（`HUB_SHUTDOWN`，“Agent Hub 正在退出”）；否则 `new AcpSession(...)`，放进 `sessions`，`await session.open()`；失败时移出 `sessions` 并原样抛出。

`AcpSession.open()`：

| 步骤 | 动作                                                                                                                                                                                                                                                                                                                              | 失败                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | 在 `params.signal` 上挂 `abort` 监听：进程已启动 → 立即 `managed.terminate()`，进行中的请求随之以连接关闭失败；还没启动 → 第 2 步返回后立即 `terminate()`。                                                                                                                                                                       | —                                                                                                                                                                              |
| 2    | `launchAcp({ cwd: params.cwd, label: "acp:<agentId>:<shortId>", taskId: params.taskId, onNotification, onRequest, onRaw: sink.raw })`；`managed.exited.then(onProcessExit)`（§8.3）。                                                                                                                                             | 原样抛出 `AgentFailure`                                                                                                                                                        |
| 3a   | 新建（`resumeNativeSessionId` 为 `null`）：`session/new { cwd, mcpServers: [] }`；`sessionId` = 响应的 `sessionId`；`state = configStateFrom(响应)`。                                                                                                                                                                             | JSON-RPC 错误 → `mapStartError(err, names, 'new')`；超时、连接关闭见第 4 步                                                                                                    |
| 3b   | 恢复：按 §9 选 `session/resume` 或 `session/load`；`sessionId = resumeNativeSessionId`；`state = configStateFrom(响应)`。Agent 两者都不支持 → 失败。                                                                                                                                                                              | 不支持 → `SESSION_NOT_RESUMABLE`（“<名称> 不支持恢复会话，请新建任务”）；JSON-RPC 错误 → `mapStartError(err, names, 'resume' / 'load')`                                        |
| 4    | 第 3、6 步的请求超时或连接关闭。                                                                                                                                                                                                                                                                                                  | 超时 → `AGENT_PROTOCOL_ERROR`（§6.4 末尾）；连接关闭 → `exit = await managed.terminate()`，`AGENT_PROCESS_EXITED`（“<名称> 进程意外退出（退出码 <code>）”，`retryable: true`） |
| 5    | 第 2–3 步期间收到过未登录的 `_auth/status_update` → 失败（D60）。                                                                                                                                                                                                                                                                 | `AGENT_AUTH_REQUIRED`（`authHint`）；上报健康 `auth_required`                                                                                                                  |
| 6    | 模式（§5）：`targetMode = pickTargetMode(state, profile.modes[params.mode])`。为 `null` → 记 `warn`（“<名称> 没有可用的 <偏好列表> 模式，Hub 不管理会话模式”）；否则 `allowed = allowedModes(targetMode, profile.modes, params.mode)`，当前模式不等于 `targetMode` 时 `apply(modeChange(state, sessionId, targetMode))`（§4.4）。 | `mapConfigError(err, names, change)`                                                                                                                                           |
| 7    | 新建时：用 `normalizeAcpModels(第 3a 步的 state)` 更新适配器缓存的能力（`resume` 取 `info.resume !== null`，`fetchedAt` = 现在）并 `deps.report.capabilities()`。恢复时不更新（响应里的当前值不是 Agent 的默认值）。                                                                                                              | —                                                                                                                                                                              |
| 8    | `params.signal.aborted` → 释放（结束进程），抛任意错误（接口 §6.1 规则 2）。                                                                                                                                                                                                                                                      | —                                                                                                                                                                              |
| 9    | `sink.emit({ type: 'session.started', nativeSessionId: sessionId, model: currentModel(state), resumed })`；健康不是 `ready` 时上报 `ready`（版本取 `info.version`）。                                                                                                                                                             | —                                                                                                                                                                              |

第 3–6 步失败时先结束进程（`conn.close()`、`managed.terminate()`）再抛 `AgentFailure`；`params.signal` 已中止时不管错误内容（`TaskRunner` 记 `cancelled`）。

### 4.4 配置状态

`AcpSession.state: AcpConfigState` 是会话的配置项、模式和旧模型字段的最新快照。所有更新都用 `mapping.ts` 的函数，**整体替换**，不在原对象上改：

| 来源                                                   | 更新                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `session/new`、`session/resume`、`session/load` 的响应 | `configStateFrom(响应)`                                              |
| `session/set_config_option` 的响应                     | `withConfigOptions(state, 响应.configOptions)`                       |
| `session/set_mode` 成功                                | `withCurrentMode(state, modeId)`                                     |
| `session/set_model` 成功                               | `withLegacyModel(state, modelId)`                                    |
| `config_option_update` 通知                            | `withConfigOptions(state, update.configOptions)`，再跑模式守卫（§5） |
| `current_mode_update` 通知                             | `withCurrentMode(state, update.currentModeId)`，再跑模式守卫         |

**`apply(change: ConfigChange)`**：`acpRequest(conn, change.method, change.params)`（`switch (change.method)` 让参数类型收窄），成功后按上表更新 `state`；JSON-RPC 错误由调用方用 `mapConfigError(err, names, change)` 转成 `AgentError`，超时与连接关闭按 §6.4 末尾处理。模型、推理档位、模式都只认配置项的 `category`（`model` / `thought_level` / `mode`），不认 `id`；`model_config` 等其他类别（Claude Code 的 `fast`、`ultracode`）不碰。

### 4.5 每轮的模型与推理档位

ACP 的配置是**会话级**的：上一轮切的模型会留到下一轮。所以每轮发提示词前都按本轮的目标值对齐一次，`model` / `reasoningEffort` 为 `null` 表示“回到 Agent 的默认值”（同 Codex 的做法，[adapter-codex.md](adapter-codex.md) §4.3）。

循环调用 `nextTurnChange(state, adapter.capabilities().models, { model, reasoningEffort }, sessionId, names)`，最多 3 次：

| 返回                | 动作                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `null`              | 已对齐，发提示词。                                                                             |
| `ConfigChange`      | `apply(change)`；成功后再调一次。失败 → 本轮以 `mapConfigError()` 的错误结束，**不发提示词**。 |
| `AgentError`        | 本轮以它结束（`MODEL_NOT_SUPPORTED`），不发提示词。                                            |
| 3 次后仍不是 `null` | 记 `warn`（“<名称> 的模型配置没有收敛”），照常发提示词。                                       |

`nextTurnChange` 的规则：

1. 用户**明确**选的模型、推理档位先一起校验，再发任何请求：Agent 没有选模型的途径 → “<名称> 不支持选择模型”；值不在可选项里 → “<名称> 没有模型“x””；推理档位同理（“不支持选择推理档位” / “没有推理档位“x””）。
2. 目标模型 = 本轮的 `model` ?? 能力里 `isDefault` 的模型。与当前值不同 → 有 `model` 类配置项时发 `session/set_config_option`，否则（只有旧 `models` 字段）发 `session/set_model`。
3. 目标档位 = 本轮的 `reasoningEffort` ?? 目标模型的 `defaultReasoningEffort`。有 `thought_level` 类配置项、值可选、且与当前值不同 → 发 `session/set_config_option`。
4. 能力里的模型列表为空（还没有成功建过会话）且用户没有明确选择 → 什么都不动。

能力里的模型列表来自最近一次**新建**会话（§4.3 第 7 步）：每个模型值一项，推理档位取当时 `thought_level` 配置项的全部值、默认档位取它的当前值（ACP 只告诉“当前模型”的档位）。已知限制：Claude Code 换模型后档位列表可能变化，用户明确选的档位在新模型上没有时，模型已经切过去、本轮才以 `MODEL_NOT_SUPPORTED` 失败；下一轮会重新对齐。

## 5. 会话模式

会话模式决定 Agent 哪些操作要先问人，是没有沙箱时“只读”的主要防线（D37）。

- **目标模式**：建会话时（§4.3 第 6 步）取 `profile.modes[任务模式]` 里第一个 Agent 提供的模式，切过去。恢复的会话也重新切（Claude Code 恢复后模式会保留，但不能依赖）。
- **允许的模式** `allowedModes()`：只读任务只允许目标模式；可写任务另外允许 profile 的只读模式（Agent 自己进入计划模式更保守，不拦）。
- **模式守卫**：每次收到 `config_option_update` / `current_mode_update` 并更新 `state` 后，`targetMode` 不为 `null` 且 `currentMode(state)` 不在 `allowed` 里 → `apply(modeChange(state, sessionId, targetMode))`。同一时刻只跑一个恢复（进行中时再收到通知，等它结束后再检查一次）。
  - 成功 → `sink.emit({ type: 'notice', level: 'warning', code: 'MODE_RESTORED', message: "<名称> 切换到了“<模式>”模式，Hub 已切回“<目标模式>”" })`。
  - 失败 → 记 `error` 日志；有进行中的轮时记 `fatal = mapConfigError(...)` 并 `cancelTurn()`，本轮以 `fatal` 结束（§6.1 第 7 步）；没有进行中的轮时什么都不做，下一轮发提示词前会再检查（§6.1 第 3 步）。
- 建会话第 6 步先记下 `targetMode` 与 `allowed` 再发切换请求；Hub 自己切到目标模式时 Agent 发来的通知（Claude Code 会发 `config_option_update`）报告的就是目标模式，守卫不会动作。`targetMode` 为 `null` 时守卫不工作。
- Gemini CLI 的 `session/set_mode` 会额外发一条文本为 `[MODE_UPDATE] <模式>` 的消息块：建会话时它落在轮外被丢弃；守卫在轮内恢复模式时它会出现在回复里，接受这个瑕疵。
- 不提供给用户选模式的入口（D26）。

## 6. 一轮

### 6.1 `prompt(input)`

`AcpSession` 同一时刻最多一个活动轮，记录：`turnId`、`index`、`mapper = new AcpTurnMapper(index)`、`promptSent`、`cancelRequested`、`modeSwitchDeclined`、`fatal`（`AgentError | null`）、本轮的未决审批（JSON-RPC 请求 id → `{ controller, cancelledByAgent }`）。

| 步骤 | 动作                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 会话已关闭 → 立即返回 `{ stopReason: 'error', error: AGENT_PROCESS_EXITED（“<名称> 进程已退出”，retryable true） }`。                                                                                           |
| 2    | 建活动轮；创建 `prompt()` 的 Promise（由“结束本轮”resolve）。                                                                                                                                                   |
| 3    | 模式：`targetMode` 不为 `null` 且当前模式不在 `allowed` 里 → `apply(modeChange(...))`；失败 → 结束本轮，`error` = `mapConfigError()`（超时与连接关闭按 §6.4 末尾）。                                            |
| 4    | 模型与推理档位：§4.5 的循环（失败处理同第 3 步）。                                                                                                                                                              |
| 5    | `cancelRequested` 已为真（第 3–4 步期间被取消）→ 结束本轮，`{ stopReason: 'cancelled' }`，不发提示词。                                                                                                          |
| 6    | `promptSent = true`；`acpRequest(conn, 'session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, null)`。                                                                                              |
| 7    | 响应：`fatal` 不为 `null` → 结束本轮，`{ stopReason: 'error', error: fatal }`。否则 `turnStop(响应.stopReason, { cancelRequested, modeSwitchDeclined })`：有 `notice` 就先 `emit`；结束本轮，`{ stopReason }`。 |
| 8    | JSON-RPC 错误：`error = fatal ?? mapPromptError(err, names)`；是 `AGENT_AUTH_REQUIRED` 时上报健康 `auth_required`；结束本轮。                                                                                   |
| 9    | 连接关闭：什么都不做，由 §8.3 的进程退出处理结束本轮（它 `dispose('agent_exited')`）。                                                                                                                          |

**结束本轮**（幂等，第二次调用什么都不做）：`mapper.finish()` 的事件逐个 `emit`（接口 §3.1 规则 4 的补齐）；中止本轮全部未决审批的 `signal`（处理器随后回复 `cancelled`，§7.1）；清掉活动轮；resolve `prompt()`。`TurnResult` 不带 `usage`（核心取本轮最后一条 `usage.updated`）、不带 `nativeTurnId`。

ACP 规定本轮的 `session/update` 都在 `session/prompt` 的响应之前发出，所以响应到达时本轮的事件已全部处理完。

### 6.2 `session/update` → 事件

路由（`onNotification('session/update', params)`）：

1. `params.sessionId` 不是本会话（还没有 `sessionId` 时也算）→ 忽略，记 `debug`。
2. 正在 `session/load` 回放（§9）→ 丢弃。
3. `config_option_update` / `current_mode_update` → §4.4 与 §5，任何时候都处理。
4. 没有活动轮 → 丢弃（例如 Gemini 的 `[MODE_UPDATE]` 消息块、`available_commands_update`），记 `debug`。
5. 否则 `for (const event of turn.mapper.map(params.update)) sink.emit(event)`，同步、不 `await`（接口 §6.1 规则 8）。

`AcpTurnMapper.map()` 的映射（§12 全文）：

| `sessionUpdate`                                                                      | 产出的事件                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_message_chunk`                                                                | `message.delta`（只取 `type: "text"` 的块）                                                                                                                              |
| `agent_thought_chunk`                                                                | `reasoning.delta`（同上）                                                                                                                                                |
| `user_message_chunk`                                                                 | 无（用户输入的回显）                                                                                                                                                     |
| `tool_call`                                                                          | 先结束当前的消息 / 推理段（`*.completed`）；第一次见到该工具 → `tool.started`；有 `content` → `tool.output.delta`；`status` 为 `completed` / `failed` → `tool.completed` |
| `tool_call_update`                                                                   | 第一次见到该工具 → `tool.started`；`content` 有新内容 → `tool.output.delta`；`status` 为 `completed` / `failed` → `tool.completed`。**不**结束当前的消息段               |
| `plan`                                                                               | `plan.updated`（`entries[].content` → `step`，`explanation: null`）                                                                                                      |
| `usage_update`                                                                       | `usage.updated`（`{ totalTokens: used, contextWindow: size }`）                                                                                                          |
| `notice`                                                                             | `notice`：`warning` / `error` 带 `code: 'AGENT_WARNING'`，`info` 不带 `code`；`message` = “<title>：<description>”                                                       |
| `compaction_update`，`status: "completed"`                                           | `notice`（`info`，`CONTEXT_COMPACTED`，“Agent 压缩了会话上下文”），同一个 `compactionId` 只发一次                                                                        |
| `config_option_update`、`current_mode_update`                                        | 无（第 3 步已处理）                                                                                                                                                      |
| `available_commands_update`、`session_info_update`、`compaction_summary_chunk`、其他 | 无                                                                                                                                                                       |

工具的 `toolKind` 由 `toolKindOf()` 映射：`execute` → `command`；`read` / `edit` / `delete` / `move` / `search` / `fetch` / `think` 同名；`switch_mode` 和其他 → `other`。`title` 由 `toolTitle()` 生成，例如“执行命令：git status”“修改：src/a.ts”（Agent 给的标题压成一行，最多 120 字）。`command` 只在 `execute` 时取 `rawInput.command`（字符串或字符串数组）；`paths` 取 `locations[].path` 去重。

### 6.3 `itemId` 与补齐

- `itemId`：消息 `t<轮序号>-msg-<n>`，推理 `t<轮序号>-think-<n>`，工具 `t<轮序号>-tool-<toolCallId>`。轮序号在任务内唯一，所以 `itemId` 在任务内唯一（接口 §3.1 规则 2）。
- 一段消息（或推理）在这些时刻结束：换成另一种块、`messageId` 变了（两边都不为 `null` 时）、来了 `tool_call`、本轮结束。结束时发 `*.completed`，`text` 是这一段的完整文本。
- 工具的 `content` 每次给的是**完整的当前内容**：新文本以已发出的文本开头时只发多出的部分；否则换一行发完整文本。`diff` 内容只写一行“已修改 <路径>”：真正的 diff 由 Hub 的树快照计算（D51）。
- 工具结束后再来的更新忽略。本轮结束时还没结束的工具补发 `tool.completed`：被 Hub 拒绝过（`markDeclined`）的记 `declined`，否则 `failed`；Agent 自己以 `failed` 结束被拒绝的工具时同样记 `declined`。

### 6.4 错误

`classifyAcpError()` 先按错误码，再按错误文本（`acpErrorText()` 剥掉 Gemini 层层包裹的 JSON、`"Internal error"` 时改用 `data.details`、取第一行、最多 300 字）：

| 条件                                                                         | 分类               | `session/prompt`（`mapPromptError`）                                           | 建会话（`mapStartError`，`new`） | 恢复（`resume` / `load`）                                    |
| ---------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------ |
| `-32000`、`401`、`403`，或文本像“未登录 / API key 无效”                      | `auth`             | `AGENT_AUTH_REQUIRED`，`false`                                                 | 同左                             | 同左                                                         |
| `429`，或文本像“rate limit / quota / resource exhausted / too many requests” | `rate_limited`     | `AGENT_RATE_LIMITED`，`true`                                                   | 同左                             | `SESSION_NOT_RESUMABLE`                                      |
| 文本像“context window / prompt is too long / too many tokens”                | `context_exceeded` | `AGENT_CONTEXT_EXCEEDED`，`false`                                              | `AGENT_PROTOCOL_ERROR`，`false`  | `SESSION_NOT_RESUMABLE`                                      |
| `-32002`（资源不存在）                                                       | `not_found`        | `AGENT_PROTOCOL_ERROR`（“<名称> 拒绝了本轮请求：…”），`false`                  | 同上（“<名称> 无法新建会话：…”） | `SESSION_NOT_RESUMABLE`（“<名称> 无法恢复会话：…”），`false` |
| `-32600`、`-32601`、`-32602`                                                 | `rejected`         | 同上                                                                           | 同上                             | 同上                                                         |
| 其他                                                                         | `upstream`         | `AGENT_UPSTREAM_ERROR`（“<名称>：…”）；`-32603` 或 5xx 时 `true`，否则 `false` | `AGENT_PROTOCOL_ERROR`，`false`  | `SESSION_NOT_RESUMABLE`                                      |

`detail` 一律是 `{ code, message（最多 2000 字）, data }`。切换配置失败用 `mapConfigError()`：`auth` → `AGENT_AUTH_REQUIRED`；模式 → `AGENT_PROTOCOL_ERROR`（“<名称> 无法切换到“plan”模式：…”）；模型 / 档位 → `MODEL_NOT_SUPPORTED`（“<名称> 拒绝切换模型“x”：…”）。

不是 JSON-RPC 错误的请求失败（`launch.ts` 之后的所有请求）：

- `JsonRpcTimeoutError`（`session/prompt` 不超时，`session/close` 2 秒，其他 60 秒）→ `AGENT_PROTOCOL_ERROR`（“<名称> 没有响应 <方法>”，`retryable: true`）。
- `JsonRpcClosedError`：建会话阶段 → `AGENT_PROCESS_EXITED`（§4.3 第 4 步）；轮内 → 由 §8.3 的进程退出处理结束本轮。
- 其他异常是程序错误，照常抛出（接口 §6.1 规则 3）。

## 7. 权限请求与审批

### 7.1 `session/request_permission`

请求处理器拿到 `(method, params, id)`，返回一个 Promise：

| 步骤 | 动作                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `params.sessionId` 不是本会话，或没有活动轮 → 返回 `{ outcome: { outcome: 'cancelled' } }`，记 `warn`。                                                                                                                |
| 2    | `turn.mapper.map({ sessionUpdate: 'tool_call_update', ...params.toolCall })` 的事件逐个 `emit`：工具卡片先出现（权限请求可能早于 `tool_call`）；Claude Code “退出计划模式”的计划正文也由此显示为工具输出。             |
| 3    | 只读任务且 `isModeSwitchRequest(params)` → `markDeclined(toolCallId)`、`modeSwitchDeclined = true`，返回 `permissionResponse('reject', params.options)`。**不建审批**（§7.3）。                                        |
| 4    | 建 `AbortController`，登记到本轮的未决审批表（键为 `id`）；`outcome = await sink.requestApproval(approvalFromPermission(params, cwd), controller.signal)`；返回前从表里删除。                                          |
| 5    | `outcome` 是 `{ withdrawn: true }`：`cancelledByAgent`（§7.4）→ 抛 `JsonRpcError(-32800, 'Request cancelled')`；否则返回 `{ outcome: { outcome: 'cancelled' } }`（本轮结束、取消、释放；连接已关闭时回复被静默丢弃）。 |
| 6    | `outcome` 是 `{ decision }`：决定是 `reject` / `cancel_turn` → `markDeclined(toolCallId)`。返回 `permissionResponse(decision, params.options)`。`cancel_turn` 时核心随后取消本轮（接口 §5.1）。                        |

`approvalFromPermission()`：`kind` 按 `toolCall.kind`（`execute` → `command`；`edit` / `delete` / `move` → `file_change`；`fetch` → `network`；其他 → `other`）；`title` 同 `toolTitle()`；`execute` 时带 `cwd`（任务工作目录）和 `command`；`paths` 取 `locations`；`detail` 是 `{ toolCall: { toolCallId, kind, title, rawInput, locations }, options }`（不含 `content`，避免把整份计划或文件内容存进审批）。

### 7.2 选项与决定

| ACP 选项的 `kind` | Hub 决定                               | 说明                                                                                                                                                                               |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allow_once`      | `allow_once`                           | 有这个选项才提供“允许一次”。                                                                                                                                                       |
| `reject_once`     | `reject`                               | 有这个选项才提供“拒绝”。                                                                                                                                                           |
| `allow_always`    | **不提供**（没有 `allow_for_session`） | 会改 Agent 的持久设置：Claude Code 把允许规则写进项目的本地设置；它的“退出计划模式”还有三个 `allow_always` 选项，选了会切到 `auto` / `bypassPermissions` 等跳过审批的模式（D59）。 |
| `reject_always`   | 不提供                                 | 同上。                                                                                                                                                                             |
| —                 | `cancel_turn`                          | 总是提供：回复 `{ outcome: "cancelled" }`，核心随后取消本轮。                                                                                                                      |

实测的选项（§10）：Claude Code “退出计划模式” → `exit-plan-default`（“Yes, manually approve edits”，`allow_once`）、`reject`（“No, keep planning”，`reject_once`）→ 决定 `allow_once`、`reject`、`cancel_turn`。Qoder → `proceed_once`（`allow_once`）、`cancel`（`reject_once`），修改文件时另有 `proceed_always`（不提供）。

### 7.3 只读任务里的“退出计划模式”

Claude Code 在 `plan` 模式下想开始修改时，发一个 `toolCall.kind` 为 `switch_mode` 的权限请求（标题 “Approve Plan”，计划正文在 `content` 里）。只读任务里 Hub **代为拒绝**，不打扰人：允许就离开了只读模式，守卫也会立刻切回。

claude-agent-acp 0.97.0 收到 `reject` 后以 `stopReason: "cancelled"` 结束本轮。这不是人取消的，`turnStop()` 把它改记为 `end_turn` 并发一条 `notice`（`info`，`PLAN_EXIT_DECLINED`，“Agent 请求退出计划模式开始修改；这是只读任务，Hub 已代为拒绝，本轮到此结束。需要修改请新建可写任务。”）。计划正文已经作为工具输出显示在本轮里。可写任务里同样的请求照常交给人审批。

### 7.4 `$/cancel_request`

Agent 撤回它发来的请求：`params.requestId` 对应本轮未决审批表里的一项 → 标记 `cancelledByAgent`、中止它的 `signal`（审批记为 `withdrawn`，卡片变灰）；§7.1 第 5 步随后回复 `-32800`（ACP 规定被撤回的请求以这个错误码回复）。找不到对应项 → 忽略。

## 8. 取消、释放与进程退出

### 8.1 `cancelTurn()`

没有活动轮或 `cancelRequested` 已为真 → 什么都不做。否则 `cancelRequested = true`；已发出提示词（`promptSent`）→ 发 `session/cancel { sessionId }` 通知；然后中止本轮全部未决审批的 `signal`（处理器回复 `cancelled`，ACP 要求取消时必须这样回复挂起的权限请求）。不等轮结束：Agent 随后以 `stopReason: "cancelled"` 响应 `session/prompt`。核心等 10 秒，没结束就 `dispose('cancelled')`（[architecture.md](architecture.md) §3.3）。还没发提示词时由 §6.1 第 5 步结束本轮。

### 8.2 `dispose(reason)`

幂等（重复调用返回同一个 Promise）：

1. 有活动轮：连接还开着且已发出提示词 → 发 `session/cancel`；按接口 §6.1 规则 5 的表直接结束本轮（`agent_exited` 的错误说明带退出码：“<名称> 进程意外退出（退出码 <code>）”）。
2. 中止全部未决审批的 `signal`（结束本轮时已做；没有活动轮时这里兜底）。
3. 连接还开着、`info.close` 为真、`reason` 不是 `agent_exited` → `session/close`（2 秒，失败只记 `debug`）。
4. `conn.close()`；`managed.terminate(reason === 'shutdown' ? SHUTDOWN_TERMINATE : undefined)`。实测三个 Agent 关闭 stdin 后都在 1.4 秒内自己退出（Qoder 约 1.4 秒、Gemini 23 毫秒、Claude Code 9 毫秒），用不到 SIGTERM。
5. 从适配器的 `sessions` 移除；resolve `closed`。

`dispose('idle')` 由 `TaskRunner` 在任务闲置满 `idleTimeoutMinutes`（ACP 默认 10 分钟）后调用；之后的追问走 §9 恢复。

### 8.3 进程退出

`managed.exited` resolve 且会话不在释放中 → 记下退出信息（§8.2 第 1 步的说明用）、记 `warn` 日志（`label`、退出码、`stderrTail()`，日志实现会脱敏）→ `dispose('agent_exited')`：进行中的轮以 `AGENT_PROCESS_EXITED` 结束，任务记 `interrupted`（接口 §4）。**不改健康状态**：进程是每个任务一个，下一个任务会起新进程。

连接先关闭而进程还在（Agent 关掉了自己的 stdout）：`conn.closed` resolve 后 5 秒进程还没退出 → `managed.terminate()`，随后照上面处理。

### 8.4 `shutdown()`

记下“正在停机”（之后的 `startSession` 抛 `HUB_SHUTDOWN`）；对全部会话并行 `dispose('shutdown')`；进行中的探测进程用 `SHUTDOWN_TERMINATE` 结束。幂等。

## 9. 恢复会话

`startSession` 带 `resumeNativeSessionId` 时（追问而活动会话表里没有会话：闲置结束、侧车重启、进程崩溃）：

| `info.resume`（新进程 `initialize` 的结果）       | 请求                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'resume'`（声明了 `sessionCapabilities.resume`） | `session/resume { sessionId, cwd, mcpServers: [] }`：不回放历史。                                                                                                                                |
| `'load'`（只声明了 `loadSession`）                | `session/load { sessionId, cwd, mcpServers: [] }`：Agent 先把整段历史以 `session/update` 回放一遍再响应。回放期间 `replaying = true`，**全部丢弃**（Hub 有自己的历史），响应到达后置回 `false`。 |
| `null`                                            | `SESSION_NOT_RESUMABLE`（“<名称> 不支持恢复会话，请新建任务”）。                                                                                                                                 |

- `session/resume` 失败时**不**改试 `session/load`：Agent 说会话不存在（`-32002`），`load` 也不会成功。
- 恢复后照 §4.3 第 6 步重新切目标模式；模型与推理档位在下一轮发提示词前对齐（实测 Claude Code 恢复后模式保留、模型回到 `default`）。
- 恢复失败时本轮与任务 `failed`（`SESSION_NOT_RESUMABLE`），要继续只能新建任务。

## 10. 兼容性

改了 `protocol.ts` / `mapping.ts`、升级 SDK 或某个 Agent 后更新本表；`profile.verifiedVersions` 与本表的“已验证”行保持一致。`initialize` 返回的版本不在 `verifiedVersions` 里时照常使用，Agent 卡片显示“未验证的版本”。

| 对象                                 | 日期       | 结论   | 验证内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agentclientprotocol/sdk` 2.0.2     | 2026-10-27 | 已验证 | 顶层入口是稳定的 ACP v1，类型能在 CommonJS 下 `import type`；`ClientCapabilities.session.notices` / `compaction` 是 Agent 发 `notice` / 压缩通知的前提；`$/cancel_request` 撤回请求、回 `-32800`；`session/set_model` 和响应里的 `models` 字段不在稳定 schema 里（§11 自己声明）。                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Qoder CLI 1.1.80（`qodercli --acp`） | 2026-10-27 | 已验证 | 握手约 4.4 秒；`agentInfo.version` 为 `1.1.80`；声明 `loadSession` 与 `sessionCapabilities.resume` / `close` / `list` / `delete` / `fork`；`authMethods` 只有 `qodercli-login`；未登录时 `session/new` 返回 `-32000` “Authentication required: …”；关闭 stdin 后约 1.4 秒退出（退出码 0）。读源码确认：配置项 `mode`（`category: mode`，`default` / `acceptEdits` / `auto` / `dontAsk` / `yolo`）、`model`、`reasoning_effort`（`thought_level`），同时返回旧 `models` 字段；支持 `session/set_model`、`set_config_option`、`set_mode`；权限选项 `proceed_once` / `cancel`（修改另有 `proceed_always`）。                                                                                                                          |
| Qoder CLI 1.1.80                     | —          | 待人工 | 登录状态下的完整一轮：模型与档位切换、`default` 模式下命令与修改的权限请求、`current_mode_update` 是否发送、恢复。按 [testing.md](testing.md) §7 的清单在 owner 的 Mac 上验证后改本行。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| claude-agent-acp 0.97.0              | 2026-10-28 | 已验证 | 握手约 0.2 秒；声明 `loadSession` 与 `resume` / `close` 等；未登录时先发 `_auth/status_update`（`kind: "none"`）、`session/new` 照样成功、`session/prompt` 返回 `-32000` “Authentication required”；配置项 `mode` / `model` / `effort`（`thought_level`，`default` / `low` / `medium` / `high` / `xhigh` / `max`）/ `fast` / `ultracode`（`model_config`）；`set_config_option` 返回完整配置项，非法值返回 `-32603` 且 `data.details` 说明原因；`session/set_mode` 回 `{}` 并发 `config_option_update`；`session/close` 回 `{}`；恢复后模式保留、模型回到 `default`，`session/load` 会回放 `user_message_chunk`；恢复不存在的会话返回 `-32002`；关闭 stdin 后 9 毫秒退出。读源码确认“退出计划模式”的权限请求与选项（§7.2、§7.3）。 |
| claude-agent-acp 0.97.0              | —          | 待人工 | 登录状态下的完整一轮：`plan` 模式下的只读任务与“退出计划模式”被拒后的 `stopReason`、可写任务的修改与命令审批、`_auth/status_update` 在已登录时的 `kind`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Gemini CLI 0.65.0（`gemini --acp`）  | 2026-10-28 | 已验证 | 握手约 1.2 秒；只声明 `loadSession`（`session/resume` 返回 `-32601`）；没有配置项（`session/set_config_option` 返回 `-32601`），`session/new` 返回 `modes`（`default` / `autoEdit` / `yolo` / `plan`）和旧 `models`（当前为 `auto`）；`session/set_model`、`session/set_mode` 回 `{}`，后者额外发一条 `[MODE_UPDATE] <模式>` 消息块；没有 API key 时 `session/new` 返回 `-32000`；key 无效时 `session/prompt` 返回错误码 `400`、message 是层层包裹的 JSON；新进程里 `session/load` 返回 `-32000`（当时用的是假 key）；关闭 stdin 后 23 毫秒退出。                                                                                                                                                                                  |
| Gemini CLI 0.65.0                    | —          | 待人工 | 登录状态下的完整一轮、`plan` 模式的只读效果、`session/load` 恢复。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 11. 协议类型

// server/src/adapters/acp/protocol.ts
/\*\*

- ACP 协议类型：取自 @agentclientprotocol/sdk 2.0.2 的稳定 v1 入口，只用 import type（D34）。
- 另有两处稳定 schema 之外、实测仍在用的旧接口：session/new 等响应里的 models 字段，
- 以及 session/set_model（Gemini CLI 0.65.0 只支持这一种选模型方式，§4.1）。
  \*/
  import type {
  ClientCapabilities,
  CloseSessionRequest,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  } from '@agentclientprotocol/sdk';
  import type { JsonRpcConnection } from '../jsonrpc/connection';

export type {
AgentCapabilities,
CancelNotification,
CancelRequestNotification,
ClientCapabilities,
ContentBlock,
InitializeResponse,
PermissionOption,
PlanEntry as AcpPlanEntry,
PromptResponse,
RequestPermissionRequest,
RequestPermissionResponse,
SessionConfigOption,
SessionConfigSelectOption,
SessionModeState,
SessionNotification,
SessionUpdate,
StopReason as AcpStopReason,
ToolCall,
ToolCallContent,
ToolCallLocation,
ToolCallUpdate,
ToolKind as AcpToolKind,
UsageUpdate,
} from '@agentclientprotocol/sdk';

export const ACP_PROTOCOL_VERSION = 1;

/\*_ D36：不让 Agent 经 Hub 读写文件或开终端；只声明能显示 notice。 _/
export const ACP_CLIENT_CAPABILITIES: ClientCapabilities = {
fs: { readTextFile: false, writeTextFile: false },
terminal: false,
session: { notices: {} },
};

export const ACP_ERROR = {
AUTH_REQUIRED: -32000,
RESOURCE_NOT_FOUND: -32002,
REQUEST_CANCELLED: -32800,
INVALID_REQUEST: -32600,
METHOD_NOT_FOUND: -32601,
INVALID_PARAMS: -32602,
INTERNAL_ERROR: -32603,
} as const;

/\*_ 旧的模型字段（ACP 不稳定 schema 的 SessionModelState）。 _/
export interface LegacySessionModelState {
availableModels: Array<{ modelId: string; name: string; description?: string | null }>;
currentModelId: string;
}

export interface SetSessionModelRequest {
sessionId: string;
modelId: string;
}

type WithLegacyModels<T> = T & { models?: LegacySessionModelState | null };

/\*_ Hub 发出的全部请求；acpRequest 只接受这些方法名。 _/
export interface AcpRequestMap {
initialize: { params: InitializeRequest; result: InitializeResponse };
'session/new': { params: NewSessionRequest; result: WithLegacyModels<NewSessionResponse> };
'session/load': { params: LoadSessionRequest; result: WithLegacyModels<LoadSessionResponse> };
'session/resume': {
params: ResumeSessionRequest;
result: WithLegacyModels<ResumeSessionResponse>;
};
'session/set_config_option': {
params: SetSessionConfigOptionRequest;
result: SetSessionConfigOptionResponse;
};
'session/set_mode': { params: SetSessionModeRequest; result: unknown };
'session/set_model': { params: SetSessionModelRequest; result: unknown };
'session/prompt': { params: PromptRequest; result: PromptResponse };
'session/close': { params: CloseSessionRequest; result: unknown };
}
export type AcpMethod = keyof AcpRequestMap;

/** Hub 发出的通知只有这一个。 \*/
export const ACP_CANCEL_METHOD = 'session/cancel';
/** Agent 发来、Hub 处理的方法；其余请求回 -32601，其余通知只进 transcript（§2）。 _/
export const ACP_UPDATE_METHOD = 'session/update';
export const ACP_PERMISSION_METHOD = 'session/request_permission';
/\*\* Agent 撤回它发给 Hub 的请求（例如未决的权限请求）。 _/
export const ACP*CANCEL_REQUEST_METHOD = '$/cancel_request';
/\** claude-agent-acp 的扩展通知：{ authStatus: { kind, label } }，kind 为 "none" 表示未登录。 \_/
export const ACP_AUTH_STATUS_METHOD = '\_auth/status_update';

export function acpRequest<M extends AcpMethod>(
conn: JsonRpcConnection,
method: M,
params: AcpRequestMap[M]['params'],
timeoutMs?: number | null,
): Promise<AcpRequestMap[M]['result']> {
return conn.request<AcpRequestMap[M]['result']>(
method,
params,
timeoutMs === undefined ? {} : { timeoutMs },
);
}

## 12. 映射函数

// server/src/adapters/acp/mapping.ts
import {
reasoningEffortLabel,
type AgentError,
type AgentEvent,
type ApprovalDecision,
type ApprovalKind,
type ModelOption,
type PlanEntry,
type StopReason,
type TaskMode,
type ToolKind,
} from '@agent-hub/contract';
import { agentError, toJsonValue, type ApprovalRequestInput } from '../types';
import {
ACP_ERROR,
type AcpStopReason,
type InitializeResponse,
type LegacySessionModelState,
type PermissionOption,
type RequestPermissionRequest,
type RequestPermissionResponse,
type SessionConfigOption,
type SessionConfigSelectOption,
type SessionModeState,
type SessionUpdate,
type SetSessionModelRequest,
type ToolCall,
type ToolCallContent,
type ToolCallLocation,
type ToolCallUpdate,
} from './protocol';

/\*_ 出现在错误说明里的名字；authHint 来自 profile（profiles.ts）。 _/
export interface AcpNames {
displayName: string;
authHint: string;
}

// ───────────────────────── 握手 ─────────────────────────

export interface AcpAgentInfo {
version: string | null;
/** 恢复会话的方式：优先 session/resume，其次 session/load（§9）。 \*/
resume: 'resume' | 'load' | null;
/** 支持 session/close。 \*/
close: boolean;
}

export function agentInfoFrom(init: InitializeResponse): AcpAgentInfo {
const caps = init.agentCapabilities ?? {};
const sessionCaps = caps.sessionCapabilities ?? {};
return {
version: init.agentInfo?.version ?? null,
resume: sessionCaps.resume ? 'resume' : caps.loadSession ? 'load' : null,
close: Boolean(sessionCaps.close),
};
}

/\*_ \_auth/status_update 的参数表示未登录（claude-agent-acp 0.97.0 未登录时 session/new 照样成功）。 _/
export function isLoggedOutStatus(params: unknown): boolean {
return isRecord(params) && isRecord(params.authStatus) && params.authStatus.kind === 'none';
}

// ───────────────────────── 错误 ─────────────────────────

export interface AcpErrorLike {
code: number;
message: string;
data?: unknown;
}

const MAX*ERROR_TEXT = 300;
const AUTH_TEXT =
/authentication required|not logged in|unauthori[sz]ed|api[ *-]?key\b[^.]\*\b(?:missing|not valid|invalid|not configured)|api_key_invalid/i;
const RATE_TEXT = /rate.?limit|quota|resource.?exhausted|too many requests/i;
const CONTEXT_TEXT =
/context (?:window|length)|maximum context|prompt is too long|too many tokens/i;

/\*_ 剥掉层层包裹的 JSON（Gemini 把上游响应原样放进 message），取第一行，最多 300 字。 _/
export function acpErrorText(err: AcpErrorLike): string {
let text = err.message;
for (let depth = 0; depth < 4; depth++) {
const inner = innerMessage(text);
if (inner === null) break;
text = inner;
}
const details = isRecord(err.data) ? err.data.details : undefined;
if (typeof details === 'string' && /^internal error$/i.test(text.trim())) text = details;
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > MAX_ERROR_TEXT ? `${line.slice(0, MAX_ERROR_TEXT)}…` : line;
}

function innerMessage(text: string): string | null {
const trimmed = text.trim();
if (!trimmed.startsWith('{')) return null;
try {
const parsed: unknown = JSON.parse(trimmed);
if (!isRecord(parsed)) return null;
const nested = isRecord(parsed.error) ? parsed.error.message : parsed.message;
return typeof nested === 'string' ? nested : null;
} catch {
return null;
}
}

export type AcpErrorClass =
| 'auth'
| 'rate_limited'
| 'context_exceeded'
| 'not_found'
| 'rejected'
| 'upstream';

export function classifyAcpError(err: AcpErrorLike): AcpErrorClass {
const text = `${err.message}\n${acpErrorText(err)}`;
if (err.code === ACP_ERROR.AUTH_REQUIRED || err.code === 401 || err.code === 403) return 'auth';
if (AUTH_TEXT.test(text)) return 'auth';
if (err.code === 429 || RATE_TEXT.test(text)) return 'rate_limited';
if (CONTEXT_TEXT.test(text)) return 'context_exceeded';
if (err.code === ACP_ERROR.RESOURCE_NOT_FOUND) return 'not_found';
if (
err.code === ACP_ERROR.INVALID_REQUEST ||
err.code === ACP_ERROR.METHOD_NOT_FOUND ||
err.code === ACP_ERROR.INVALID_PARAMS
) {
return 'rejected';
}
return 'upstream';
}

function errorDetail(err: AcpErrorLike) {
return toJsonValue({ code: err.code, message: err.message.slice(0, 2000), data: err.data });
}

function authError(err: AcpErrorLike, names: AcpNames): AgentError {
return agentError('AGENT_AUTH_REQUIRED', names.authHint, false, errorDetail(err));
}

/\*_ session/prompt 的 JSON-RPC 错误 → 本轮的错误（§6.4）。 _/
export function mapPromptError(err: AcpErrorLike, names: AcpNames): AgentError {
const text = acpErrorText(err);
const detail = errorDetail(err);
switch (classifyAcpError(err)) {
case 'auth':
return authError(err, names);
case 'rate_limited':
return agentError('AGENT_RATE_LIMITED', `${names.displayName}：${text}`, true, detail);
case 'context_exceeded':
return agentError('AGENT_CONTEXT_EXCEEDED', `${names.displayName}：${text}`, false, detail);
case 'not_found':
case 'rejected':
return agentError(
'AGENT_PROTOCOL_ERROR',
`${names.displayName} 拒绝了本轮请求：${text}`,
false,
detail,
);
case 'upstream': {
const retryable =
err.code === ACP_ERROR.INTERNAL_ERROR || (err.code >= 500 && err.code < 600);
return agentError('AGENT_UPSTREAM_ERROR', `${names.displayName}：${text}`, retryable, detail);
}
}
}

/\*_ 建会话（new）或恢复会话（resume / load）的 JSON-RPC 错误（§4.1 第 7 步）。 _/
export function mapStartError(
err: AcpErrorLike,
names: AcpNames,
phase: 'new' | 'resume' | 'load',
): AgentError {
const kind = classifyAcpError(err);
if (kind === 'auth') return authError(err, names);
const text = acpErrorText(err);
if (phase !== 'new') {
return agentError(
'SESSION_NOT_RESUMABLE',
`${names.displayName} 无法恢复会话：${text}`,
false,
errorDetail(err),
);
}
if (kind === 'rate_limited') {
return agentError(
'AGENT_RATE_LIMITED',
`${names.displayName}：${text}`,
true,
errorDetail(err),
);
}
return agentError(
'AGENT_PROTOCOL_ERROR',
`${names.displayName} 无法新建会话：${text}`,
false,
errorDetail(err),
);
}

/\*_ 切换模型、推理档位或会话模式失败（§4.3、§5）。 _/
export function mapConfigError(
err: AcpErrorLike,
names: AcpNames,
change: ConfigChange,
): AgentError {
if (classifyAcpError(err) === 'auth') return authError(err, names);
const text = acpErrorText(err);
if (change.target === 'mode') {
return agentError(
'AGENT_PROTOCOL_ERROR',
`${names.displayName} 无法切换到“${change.value}”模式：${text}`,
false,
errorDetail(err),
);
}
const what = change.target === 'model' ? '模型' : '推理档位';
return agentError(
'MODEL_NOT_SUPPORTED',
`${names.displayName} 拒绝切换${what}“${change.value}”：${text}`,
false,
errorDetail(err),
);
}

// ───────────────────────── 会话配置：模型、推理档位、模式 ─────────────────────────

type SelectConfigOption = Extract<SessionConfigOption, { type: 'select' }>;

/\*_ 一个会话的配置项、模式与旧模型字段；每次 Agent 告知新值就整体替换（§4.2）。 _/
export interface AcpConfigState {
options: SessionConfigOption[];
modes: SessionModeState | null;
legacyModels: LegacySessionModelState | null;
}

export function configStateFrom(response: {
configOptions?: SessionConfigOption[] | null;
modes?: SessionModeState | null;
models?: unknown;
}): AcpConfigState {
return {
options: response.configOptions ?? [],
modes: response.modes ?? null,
legacyModels: isLegacyModels(response.models) ? response.models : null,
};
}

function isLegacyModels(value: unknown): value is LegacySessionModelState {
return (
isRecord(value) &&
typeof value.currentModelId === 'string' &&
Array.isArray(value.availableModels) &&
value.availableModels.every(
(m) => isRecord(m) && typeof m.modelId === 'string' && typeof m.name === 'string',
)
);
}

/\*_ set_config_option 的响应、config_option_update 通知：替换配置项，并同步模式。 _/
export function withConfigOptions(
state: AcpConfigState,
options: SessionConfigOption[],
): AcpConfigState {
const next: AcpConfigState = { ...state, options };
const mode = selectOption(next, 'mode');
if (mode && next.modes) next.modes = { ...next.modes, currentModeId: mode.currentValue };
return next;
}

/\*_ current_mode_update 通知、set_mode 成功。 _/
export function withCurrentMode(state: AcpConfigState, modeId: string): AcpConfigState {
return {
...state,
modes: state.modes ? { ...state.modes, currentModeId: modeId } : null,
options: state.options.map((o) =>
o.type === 'select' && o.category === 'mode' ? { ...o, currentValue: modeId } : o,
),
};
}

/\*_ set_model 成功（Agent 不另发通知）。 _/
export function withLegacyModel(state: AcpConfigState, modelId: string): AcpConfigState {
return state.legacyModels
? { ...state, legacyModels: { ...state.legacyModels, currentModelId: modelId } }
: state;
}

export function selectOption(
state: AcpConfigState,
category: 'mode' | 'model' | 'thought_level',
): SelectConfigOption | null {
for (const option of state.options) {
if (option.type === 'select' && option.category === category) return option;
}
return null;
}

function flatten(option: SelectConfigOption): SessionConfigSelectOption[] {
return option.options.flatMap(
(o: SessionConfigSelectOption | { options: SessionConfigSelectOption[] }) =>
'options' in o ? o.options : [o],
);
}

export function currentModel(state: AcpConfigState): string | null {
return selectOption(state, 'model')?.currentValue ?? state.legacyModels?.currentModelId ?? null;
}

export function currentMode(state: AcpConfigState): string | null {
return selectOption(state, 'mode')?.currentValue ?? state.modes?.currentModeId ?? null;
}

export function availableModeIds(state: AcpConfigState): string[] {
const option = selectOption(state, 'mode');
if (option) return flatten(option).map((o) => o.value);
return state.modes?.availableModes.map((m) => m.id) ?? [];
}

/\*_ profile.modes[任务模式] 里第一个 Agent 提供的模式；没有则不管理模式（D37）。 _/
export function pickTargetMode(
state: AcpConfigState,
preferences: readonly string[],
): string | null {
const available = availableModeIds(state);
return preferences.find((id) => available.includes(id)) ?? null;
}

/\*\*

- 会话可以停留的模式（§5 模式守卫）：只读任务只允许目标模式；
- 可写任务另外允许 profile 里的只读模式（Agent 自己进入计划模式更保守，不拦）。
  \*/
  export function allowedModes(
  target: string,
  modes: Record<TaskMode, readonly string[]>,
  taskMode: TaskMode,
  ): string[] {
  return taskMode === 'read_only'
  ? [target]
  : [...new Set([target, ...modes.write, ...modes.read_only])];
  }

export type ConfigChange =
| {
target: 'model' | 'effort' | 'mode';
value: string;
method: 'session/set_config_option';
params: { sessionId: string; configId: string; value: string };
}
| {
target: 'model';
value: string;
method: 'session/set_model';
params: SetSessionModelRequest;
}
| {
target: 'mode';
value: string;
method: 'session/set_mode';
params: { sessionId: string; modeId: string };
};

/\*_ 有 mode 类配置项时用 set_config_option（Claude Code、Qoder），否则 set_mode（Gemini）。 _/
export function modeChange(state: AcpConfigState, sessionId: string, modeId: string): ConfigChange {
const option = selectOption(state, 'mode');
return option
? {
target: 'mode',
value: modeId,
method: 'session/set_config_option',
params: { sessionId, configId: option.id, value: modeId },
}
: { target: 'mode', value: modeId, method: 'session/set_mode', params: { sessionId, modeId } };
}

/\*\*

- 发提示词前把模型、推理档位对齐到本轮的目标值（§4.3）：返回下一步要发的请求，已对齐时返回 null，
- 用户明确要求了 Agent 不提供的值时返回错误。会话每应用一步就更新状态再调用一次。
- 目标值：用户选的值；没选时用 models（Agent 能力）里的默认模型及其默认档位；models 为空则不动。
- 用户明确要求的值在发出任何请求前一起校验，避免切了模型才发现档位不支持。
  \*/
  export function nextTurnChange(
  state: AcpConfigState,
  models: ModelOption[],
  input: { model: string | null; reasoningEffort: string | null },
  sessionId: string,
  names: AcpNames,
  ): ConfigChange | AgentError | null {
  const notSupported = (message: string) =>
  agentError('MODEL_NOT_SUPPORTED', `${names.displayName} ${message}`, false);
  const modelOption = selectOption(state, 'model');
  const effortOption = selectOption(state, 'thought_level');
  const modelIds = modelOption
  ? flatten(modelOption).map((o) => o.value)
  : (state.legacyModels?.availableModels.map((m) => m.modelId) ?? null);
  const effortIds = effortOption ? flatten(effortOption).map((o) => o.value) : null;

if (input.model !== null) {
if (modelIds === null) return notSupported('不支持选择模型');
if (!modelIds.includes(input.model)) return notSupported(`没有模型“${input.model}”`);
}
if (input.reasoningEffort !== null) {
if (effortIds === null) return notSupported('不支持选择推理档位');
if (!effortIds.includes(input.reasoningEffort)) {
return notSupported(`没有推理档位“${input.reasoningEffort}”`);
}
}

const wantModel = input.model ?? models.find((m) => m.isDefault)?.id ?? null;
if (wantModel !== null && modelIds?.includes(wantModel) && currentModel(state) !== wantModel) {
return modelOption
? {
target: 'model',
value: wantModel,
method: 'session/set_config_option',
params: { sessionId, configId: modelOption.id, value: wantModel },
}
: {
target: 'model',
value: wantModel,
method: 'session/set_model',
params: { sessionId, modelId: wantModel },
};
}

const effectiveModel = wantModel ?? currentModel(state);
const wantEffort =
input.reasoningEffort ??
models.find((m) => m.id === effectiveModel)?.defaultReasoningEffort ??
null;
if (
wantEffort === null ||
!effortOption ||
!effortIds?.includes(wantEffort) ||
effortOption.currentValue === wantEffort
) {
return null;
}
return {
target: 'effort',
value: wantEffort,
method: 'session/set_config_option',
params: { sessionId, configId: effortOption.id, value: wantEffort },
};
}

/\*\*

- Agent 能力里的模型列表：model 类配置项（或旧 models 字段）的每个值一个模型；
- thought_level 类配置项的值作为每个模型的推理档位（ACP 只告知当前模型的档位，§4.2）。
- 只用 session/new 的响应调用：那时的当前值就是 Agent 的默认值。
  \*/
  export function normalizeAcpModels(state: AcpConfigState): ModelOption[] {
  const effort = selectOption(state, 'thought_level');
  const efforts = effort
  ? flatten(effort).map((o) => ({
  id: o.value,
  label: reasoningEffortLabel(o.value),
  description: o.description || undefined,
  }))
  : [];
  const defaultEffort = efforts.length > 0 && effort ? effort.currentValue : null;
  const modelOption = selectOption(state, 'model');
  const raw = modelOption
  ? flatten(modelOption).map((o) => ({
  id: o.value,
  label: o.name || o.value,
  description: o.description || undefined,
  isDefault: o.value === modelOption.currentValue,
  }))
  : (state.legacyModels?.availableModels.map((m) => ({
  id: m.modelId,
  label: m.name || m.modelId,
  description: m.description || undefined,
  isDefault: m.modelId === state.legacyModels?.currentModelId,
  })) ?? []);
  const seen = new Set<string>();
  return raw
  .filter((m) => !seen.has(m.id) && seen.add(m.id))
  .map((m) => ({ ...m, reasoningEfforts: efforts, defaultReasoningEffort: defaultEffort }));
  }

// ───────────────────────── 工具、轮内事件 ─────────────────────────

export function toolKindOf(kind: string | null | undefined): ToolKind {
switch (kind) {
case 'execute':
return 'command';
case 'read':
case 'edit':
case 'delete':
case 'move':
case 'search':
case 'fetch':
case 'think':
return kind;
default:
return 'other';
}
}

const TOOL_LABELS: Record<string, string> = {
read: '读取',
edit: '修改',
delete: '删除',
move: '移动',
search: '搜索',
execute: '执行命令',
think: '思考',
fetch: '联网获取',
switch_mode: '切换模式',
};

/\*_ “执行命令：git status”；Agent 给的标题压成一行、最多 120 字。 _/
export function toolTitle(
kind: string | null | undefined,
title: string | null | undefined,
): string {
const label = (kind && TOOL_LABELS[kind]) || '工具';
const text = (title ?? '').replace(/\s+/g, ' ').trim();
if (!text) return label;
return `${label}：${text.length > 120 ? `${text.slice(0, 120)}…` : text}`;
}

export function commandOf(rawInput: unknown): string | null {
if (!isRecord(rawInput)) return null;
const command = rawInput.command;
if (typeof command === 'string' && command.trim()) return command;
if (Array.isArray(command) && command.every((c) => typeof c === 'string')) {
return command.length > 0 ? command.join(' ') : null;
}
return null;
}

export function pathsOf(locations: ToolCallLocation[] | null | undefined): string[] {
return [...new Set((locations ?? []).map((l) => l.path).filter(Boolean))];
}

/\*_ 工具内容 → 文本：text 原样，diff 写一行“已修改 <路径>”，其他忽略。 _/
export function renderToolContent(content: ToolCallContent[]): string {
const parts: string[] = [];
for (const c of content) {
if (c.type === 'content' && c.content.type === 'text' && c.content.text)
parts.push(c.content.text);
else if (c.type === 'diff') parts.push(`已修改 ${c.path}`);
}
return parts.join('\n');
}

const STOP_REASONS_ACP: readonly string[] = [
'end_turn',
'max_tokens',
'max_turn_requests',
'refusal',
'cancelled',
];

/\*_ 五个取值与 Hub 同名；协议以后新增、Hub 不认识的值按 end_turn 处理。 _/
export function mapStopReason(stop: AcpStopReason): StopReason {
return STOP_REASONS_ACP.includes(stop) ? stop : 'end_turn';
}

export const PLAN_EXIT_DECLINED_MESSAGE =
'Agent 请求退出计划模式开始修改；这是只读任务，Hub 已代为拒绝，本轮到此结束。需要修改请新建可写任务。';

/\*\*

- session/prompt 的 stopReason → 本轮结果（§6.1 第 5 步）。Claude Code 在“退出计划模式”被拒后
- 以 cancelled 结束本轮；那不是人取消的，记为 end_turn 并说明原因。
  \*/
  export function turnStop(
  stop: AcpStopReason,
  flags: { cancelRequested: boolean; modeSwitchDeclined: boolean },
  ): { stopReason: StopReason; notice: AgentEvent | null } {
  const stopReason = mapStopReason(stop);
  if (stopReason === 'cancelled' && !flags.cancelRequested && flags.modeSwitchDeclined) {
  return {
  stopReason: 'end_turn',
  notice: {
  type: 'notice',
  level: 'info',
  code: 'PLAN_EXIT_DECLINED',
  message: PLAN_EXIT_DECLINED_MESSAGE,
  },
  };
  }
  return { stopReason, notice: null };
  }

type NoticeUpdate = Extract<SessionUpdate, { sessionUpdate: 'notice' }>;

function noticeEvent(n: NoticeUpdate): AgentEvent {
const message = n.description ? `${n.title}：${n.description}` : n.title;
return n.severity === 'warning' || n.severity === 'error'
? { type: 'notice', level: n.severity, code: 'AGENT_WARNING', message }
: { type: 'notice', level: 'info', message };
}

function planStatus(status: string): PlanEntry['status'] {
return status === 'in_progress' || status === 'completed' ? status : 'pending';
}

interface Segment {
kind: 'message' | 'reasoning';
itemId: string;
messageId: string | null;
text: string;
}

interface ToolState {
itemId: string;
/\*_ 已作为 tool.output.delta 发出的完整文本。 _/
emitted: string;
declined: boolean;
done: boolean;
}

/\*\*

- 一轮内的 session/update → AgentEvent（§6.2）。纯状态机，不做 IO；每轮新建一个。
- itemId：消息 t<轮序号>-msg-<n>，推理 t<轮序号>-think-<n>，工具 t<轮序号>-tool-<toolCallId>。
  \*/
  export class AcpTurnMapper {
  private segment: Segment | null = null;
  private seq = 0;
  private readonly tools = new Map<string, ToolState>();
  private readonly compactions = new Set<string>();

constructor(private readonly turnIndex: number) {}

map(update: SessionUpdate): AgentEvent[] {
switch (update.sessionUpdate) {
case 'agent_message_chunk':
return this.chunk('message', update.content, update.messageId ?? null);
case 'agent_thought_chunk':
return this.chunk('reasoning', update.content, update.messageId ?? null);
case 'tool_call':
return [...this.closeSegment(), ...this.ensureTool(update), ...this.updateTool(update)];
case 'tool_call_update':
return [...this.ensureTool(update), ...this.updateTool(update)];
case 'plan':
return [
{
type: 'plan.updated',
explanation: null,
entries: update.entries.map((e) => ({ step: e.content, status: planStatus(e.status) })),
},
];
case 'usage_update':
return [
{
type: 'usage.updated',
usage: { totalTokens: update.used, contextWindow: update.size },
},
];
case 'notice':
return [noticeEvent(update)];
case 'compaction_update':
if (update.status !== 'completed' || this.compactions.has(update.compactionId)) return [];
this.compactions.add(update.compactionId);
return [
{
type: 'notice',
level: 'info',
code: 'CONTEXT_COMPACTED',
message: 'Agent 压缩了会话上下文',
},
];
default:
return [];
}
}

/\*_ tool_call_update（含权限请求里的 toolCall）可能先于 tool_call 到达：先补一个 tool.started。 _/
private ensureTool(call: ToolCall | ToolCallUpdate): AgentEvent[] {
if (this.tools.has(call.toolCallId)) return [];
const itemId = `t${this.turnIndex}-tool-${call.toolCallId}`;
this.tools.set(call.toolCallId, { itemId, emitted: '', declined: false, done: false });
const started: Extract<AgentEvent, { type: 'tool.started' }> = {
type: 'tool.started',
itemId,
toolKind: toolKindOf(call.kind),
title: toolTitle(call.kind, call.title),
};
const command = call.kind === 'execute' ? commandOf(call.rawInput) : null;
if (command) started.command = command;
const paths = pathsOf(call.locations);
if (paths.length > 0) started.paths = paths;
return [started];
}

/\*_ Hub 拒绝了该工具的权限请求：之后以 failed 结束时记为 declined。 _/
markDeclined(toolCallId: string): void {
const tool = this.tools.get(toolCallId);
if (tool) tool.declined = true;
}

/\*_ 轮结束：补发未结束的消息 / 推理段与工具（接口 §3.1 规则 4）。 _/
finish(): AgentEvent[] {
const events = this.closeSegment();
for (const tool of this.tools.values()) {
if (tool.done) continue;
tool.done = true;
events.push({
type: 'tool.completed',
itemId: tool.itemId,
status: tool.declined ? 'declined' : 'failed',
});
}
return events;
}

private chunk(
kind: Segment['kind'],
content: { type: string; text?: string },
messageId: string | null,
): AgentEvent[] {
const text = content.type === 'text' && typeof content.text === 'string' ? content.text : '';
const events: AgentEvent[] = [];
const current = this.segment;
const continues =
current !== null &&
current.kind === kind &&
(messageId === null || current.messageId === null || current.messageId === messageId);
if (!continues) {
events.push(...this.closeSegment());
if (!text) return events;
this.seq += 1;
this.segment = {
kind,
itemId: `t${this.turnIndex}-${kind === 'message' ? 'msg' : 'think'}-${this.seq}`,
messageId,
text: '',
};
}
const segment = this.segment;
if (!text || !segment) return events;
segment.text += text;
segment.messageId ??= messageId;
events.push({
type: kind === 'message' ? 'message.delta' : 'reasoning.delta',
itemId: segment.itemId,
text,
});
return events;
}

private closeSegment(): AgentEvent[] {
const segment = this.segment;
if (!segment) return [];
this.segment = null;
return [
{
type: segment.kind === 'message' ? 'message.completed' : 'reasoning.completed',
itemId: segment.itemId,
text: segment.text,
},
];
}

private updateTool(call: ToolCall | ToolCallUpdate): AgentEvent[] {
const tool = this.tools.get(call.toolCallId);
if (!tool || tool.done) return [];
const events: AgentEvent[] = [];
if (call.content) {
const full = renderToolContent(call.content);
const delta = full.startsWith(tool.emitted)
? full.slice(tool.emitted.length)
: `${tool.emitted ? '\n' : ''}${full}`;
if (delta) events.push({ type: 'tool.output.delta', itemId: tool.itemId, text: delta });
tool.emitted = full;
}
if (call.status === 'completed' || call.status === 'failed') {
tool.done = true;
events.push({
type: 'tool.completed',
itemId: tool.itemId,
status: call.status === 'completed' ? 'completed' : tool.declined ? 'declined' : 'failed',
});
}
return events;
}
}

// ───────────────────────── 权限请求 ─────────────────────────

/\*_ 接口 §5.2：allow_always / reject_always 永远不选（会改 Agent 的持久设置），所以没有 allow_for_session。 _/
export function permissionDecisions(options: PermissionOption[]): ApprovalDecision[] {
const decisions: ApprovalDecision[] = [];
if (options.some((o) => o.kind === 'allow_once')) decisions.push('allow_once');
if (options.some((o) => o.kind === 'reject_once')) decisions.push('reject');
decisions.push('cancel_turn');
return decisions;
}

const APPROVAL_KINDS: Record<string, ApprovalKind> = {
execute: 'command',
edit: 'file_change',
delete: 'file_change',
move: 'file_change',
fetch: 'network',
};

export function approvalFromPermission(
req: RequestPermissionRequest,
cwd: string,
): ApprovalRequestInput {
const call = req.toolCall;
const input: ApprovalRequestInput = {
kind: (call.kind && APPROVAL_KINDS[call.kind]) || 'other',
title: toolTitle(call.kind, call.title),
options: permissionDecisions(req.options),
detail: toJsonValue({
toolCall: {
toolCallId: call.toolCallId,
kind: call.kind,
title: call.title,
rawInput: call.rawInput,
locations: call.locations,
},
options: req.options,
}),
};
if (call.kind === 'execute') {
input.cwd = cwd;
const command = commandOf(call.rawInput);
if (command) input.command = command;
}
const paths = pathsOf(call.locations);
if (paths.length > 0) input.paths = paths;
return input;
}

/\*_ decision 为 null 表示撤回（本轮结束、取消、释放）：回 cancelled。 _/
export function permissionResponse(
decision: ApprovalDecision | null,
options: PermissionOption[],
): RequestPermissionResponse {
const wanted =
decision === 'allow_once' ? 'allow_once' : decision === 'reject' ? 'reject_once' : null;
const chosen = wanted ? options.find((o) => o.kind === wanted) : undefined;
return chosen
? { outcome: { outcome: 'selected', optionId: chosen.optionId } }
: { outcome: { outcome: 'cancelled' } };
}

/\*_ 只读任务里 Agent 请求切换模式（Claude Code 的“退出计划模式”）：Hub 代为拒绝（§7.2）。 _/
export function isModeSwitchRequest(req: RequestPermissionRequest): boolean {
return req.toolCall.kind === 'switch_mode';
}

function isRecord(value: unknown): value is Record<string, unknown> {
return typeof value === 'object' && value !== null && !Array.isArray(value);
}

## 13. 帧示例

摘自实测记录（`->` Hub 发出，`<-` Agent 发来；长字段用 `…` 省略，id 与路径已替换）。假 ACP Agent 的场景文件照这些帧编写（[testing.md](testing.md) §3）。

claude-agent-acp 0.97.0，未登录：

```text
-> {"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false,"session":{"notices":{}}},"clientInfo":{"name":"agent_hub","title":"Agent Hub","version":"0.1.0"}}}
<- {"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"close":{},"resume":{},…},…},"agentInfo":{"name":"@agentclientprotocol/claude-agent-acp","title":"Claude Agent","version":"0.97.0"},"authMethods":[]}}
-> {"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"<repo>","mcpServers":[]}}
<- {"jsonrpc":"2.0","method":"_auth/status_update","params":{"authStatus":{"kind":"none","label":"Not logged in"}}}
<- {"jsonrpc":"2.0","id":1,"result":{"sessionId":"<sid>","modes":{"currentModeId":"default",…},"configOptions":[{"id":"mode","category":"mode","type":"select","currentValue":"default",…},{"id":"model","category":"model","currentValue":"default",…},{"id":"effort","category":"thought_level","currentValue":"default",…},…]}}
-> {"jsonrpc":"2.0","id":2,"method":"session/set_config_option","params":{"sessionId":"<sid>","configId":"model","value":"sonnet"}}
<- {"jsonrpc":"2.0","id":2,"result":{"configOptions":[…,{"id":"model","currentValue":"sonnet",…},…]}}
-> {"jsonrpc":"2.0","id":4,"method":"session/set_config_option","params":{"sessionId":"<sid>","configId":"model","value":"no-such-model"}}
<- {"jsonrpc":"2.0","id":4,"error":{"code":-32603,"message":"Internal error","data":{"details":"Invalid value for config option model: no-such-model"}}}
-> {"jsonrpc":"2.0","id":5,"method":"session/set_mode","params":{"sessionId":"<sid>","modeId":"plan"}}
<- {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"<sid>","update":{"sessionUpdate":"config_option_update","configOptions":[{"id":"mode","currentValue":"plan",…},…]}}}
<- {"jsonrpc":"2.0","id":5,"result":{}}
-> {"jsonrpc":"2.0","id":7,"method":"session/prompt","params":{"sessionId":"<sid>","prompt":[{"type":"text","text":"say hi"}]}}
<- {"jsonrpc":"2.0","id":7,"error":{"code":-32000,"message":"Authentication required"}}
-> {"jsonrpc":"2.0","id":8,"method":"session/close","params":{"sessionId":"<sid>"}}
<- {"jsonrpc":"2.0","id":8,"result":{}}
```

同一会话在新进程里恢复（先 `session/resume`，再演示 `session/load` 的回放和不存在的会话）：

```text
-> {"jsonrpc":"2.0","id":1,"method":"session/resume","params":{"sessionId":"<sid>","cwd":"<repo>","mcpServers":[]}}
<- {"jsonrpc":"2.0","id":1,"result":{"sessionId":"<sid>","modes":{"currentModeId":"plan",…},"configOptions":[{"id":"mode","currentValue":"plan",…},{"id":"model","currentValue":"default",…},…]}}
-> {"jsonrpc":"2.0","id":2,"method":"session/load","params":{"sessionId":"<sid>","cwd":"<repo>","mcpServers":[]}}
<- {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"<sid>","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"say hi"},"messageId":"…"}}}
<- {"jsonrpc":"2.0","id":2,"result":{"sessionId":"<sid>",…}}
-> {"jsonrpc":"2.0","id":3,"method":"session/resume","params":{"sessionId":"00000000-0000-0000-0000-000000000000","cwd":"<repo>","mcpServers":[]}}
<- {"jsonrpc":"2.0","id":3,"error":{"code":-32002,"message":"Resource not found: 00000000-0000-0000-0000-000000000000","data":{"uri":"00000000-0000-0000-0000-000000000000"}}}
```

Gemini CLI 0.65.0（假 API key）：

```text
<- {"jsonrpc":"2.0","id":1,"result":{"sessionId":"<sid>","modes":{"availableModes":[{"id":"default",…},{"id":"autoEdit",…},{"id":"yolo",…},{"id":"plan","description":"Read-only mode",…}],"currentModeId":"default"},"models":{"availableModels":[{"modelId":"auto","name":"Auto",…},…],"currentModelId":"auto"}}}
-> {"jsonrpc":"2.0","id":2,"method":"session/set_model","params":{"sessionId":"<sid>","modelId":"<model>"}}
<- {"jsonrpc":"2.0","id":2,"result":{}}
-> {"jsonrpc":"2.0","id":3,"method":"session/set_config_option","params":{"sessionId":"<sid>","configId":"model","value":"x"}}
<- {"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"\"Method not found\": session/set_config_option","data":{"method":"session/set_config_option"}}}
-> {"jsonrpc":"2.0","id":5,"method":"session/set_mode","params":{"sessionId":"<sid>","modeId":"plan"}}
<- {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"<sid>","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"[MODE_UPDATE] plan"}}}}
<- {"jsonrpc":"2.0","id":5,"result":{}}
-> {"jsonrpc":"2.0","id":6,"method":"session/prompt","params":{"sessionId":"<sid>","prompt":[{"type":"text","text":"say hi"}]}}
<- {"jsonrpc":"2.0","id":6,"error":{"code":400,"message":"{\"error\":{\"message\":\"{\\n  \\\"error\\\": {\\n    \\\"code\\\": 400,\\n    \\\"message\\\": \\\"API key not valid. Please pass a valid API key.\\\", …"}}
```

Qoder CLI 1.1.80，未登录：

```text
<- {"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"authMethods":[{"id":"qodercli-login","name":"Use qodercli login",…}],"agentInfo":{"name":"qoder-cli","title":"Qoder CLI","version":"1.1.80"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"close":{},"resume":{},…},…}}}
-> {"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"<repo>","mcpServers":[]}}
<- {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Authentication required: Authentication is required."}}
```
