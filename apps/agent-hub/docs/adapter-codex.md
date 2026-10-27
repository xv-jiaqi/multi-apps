# Codex 适配器

> 上级文档：[../README.md](../README.md)。接口与通用规则见 [adapter-interface.md](adapter-interface.md)（下文简称“接口”）。
>
> 依据：codex-cli **0.164.0** 的 `codex app-server`，2026-10-27 实测（未登录状态下跑通握手、建 thread、发轮、中断、退订、关 stdin 退出）。`protocol.ts`（§8）是手写的协议子集（D33），已与 `codex app-server generate-ts` 生成的类型**双向**做编译期核对；`mapping.ts`（§9）是纯函数，已用实测数据跑过单测。两个文件原样复制。

## 1. 概览

| 方面              | 做法                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| 传输              | 子进程 stdio，每行一个 JSON-RPC 消息，**不带** `jsonrpc` 字段（接口 §7.2）。                               |
| 进程              | 每个 Codex 配置**一个**常驻 `codex app-server` 进程，多个任务共享（D30）；第一次需要时启动，不做闲置结束。 |
| 原生会话          | thread；`nativeSessionId` = thread id。一个任务一个 thread。                                               |
| 轮                | turn；`TurnResult.nativeTurnId` = turn id。                                                                |
| 审批              | `approvalPolicy: "on-request"`；命令执行、文件修改、权限申请三类服务端请求（§6）。                         |
| 沙箱              | 只读任务 `read-only`，可写任务 `workspace-write`，每轮都显式关网络（§4.2）。                               |
| 模型              | `model/list` 给出可选模型与推理档位；每轮 `turn/start` 显式传模型和档位（§4.3）。                          |
| 恢复              | `thread/resume`。                                                                                          |
| 在 ChatGPT 里可见 | 新建 thread 时带 `threadSource: "user"`（D31；实际效果待人工验证，§11）。                                  |

代码文件：

| 文件                                         | 内容                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `server/src/adapters/codex/protocol.ts`      | 协议类型（§8 全文）。                                                                                      |
| `server/src/adapters/codex/mapping.ts`       | 协议 ↔ Hub 的纯函数映射（§9 全文）。                                                                       |
| `server/src/adapters/codex/codex-adapter.ts` | `CodexAdapter implements AgentAdapter`：进程、握手、探测、按 thread 分发通知与服务端请求（§3、§4.1、§6）。 |
| `server/src/adapters/codex/codex-session.ts` | `CodexSession implements AgentSession`：一个 thread 的轮、事件、审批、取消、释放（§5、§7）。               |
| `server/scripts/codex-compat/*`              | 升级 Codex 时的可选核对脚本（§11.2），不进 CI，不在 `server/tsconfig.json` 的 `include` 里。               |

## 2. 用到的方法

`CODEX_CLIENT_METHODS`（§8）就是 Hub 会发出的全部方法；`CodexAdapter` 的发送函数只接受这个类型，写错方法名编译不过。

### 2.1 Hub 发出

| 方法                 | 类型 | 何时                                  | 超时  | 参数要点                                                                                                                                                   |
| -------------------- | ---- | ------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`         | 请求 | 进程启动后第一条                      | 30 秒 | `clientInfo: { name: "agent_hub", title: "Agent Hub", version: <侧车版本> }`（D43），`capabilities: { experimentalApi: false, requestAttestation: false }` |
| `initialized`        | 通知 | `initialize` 成功后立即               | —     | 无参数                                                                                                                                                     |
| `account/read`       | 请求 | 探测时、每次 `startSession` 前（D32） | 60 秒 | `{ refreshToken: false }`                                                                                                                                  |
| `model/list`         | 请求 | 探测时                                | 60 秒 | `{ includeHidden: false, cursor }`，按 `nextCursor` 翻页，最多 10 页                                                                                       |
| `thread/start`       | 请求 | 新任务的第一个会话                    | 60 秒 | §4.1                                                                                                                                                       |
| `thread/resume`      | 请求 | 恢复会话                              | 60 秒 | §4.1                                                                                                                                                       |
| `turn/start`         | 请求 | 每轮                                  | 60 秒 | §5.1                                                                                                                                                       |
| `turn/interrupt`     | 请求 | 取消本轮、鉴权失败时                  | 60 秒 | `{ threadId, turnId }`；不等响应（§7.1）                                                                                                                   |
| `thread/unsubscribe` | 请求 | 会话释放（闲置、取消、停机、删除）    | 5 秒  | `{ threadId }`；失败只记日志                                                                                                                               |

### 2.2 Hub 处理的通知

| 方法                                                                                                                             | 处理             |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `turn/started`、`turn/completed`、`item/started`、`item/completed`                                                               | §5.2             |
| `item/agentMessage/delta`、`item/reasoning/summaryTextDelta`、`item/commandExecution/outputDelta`、`item/fileChange/outputDelta` | §5.2（增量）     |
| `turn/plan/updated`、`thread/tokenUsage/updated`                                                                                 | §5.2             |
| `error`、`warning`、`model/rerouted`                                                                                             | §5.3             |
| `serverRequest/resolved`                                                                                                         | 撤回审批（§6）   |
| `thread/closed`                                                                                                                  | 会话关闭（§7.3） |
| `account/updated`                                                                                                                | 重新探测（§3.1） |

其余通知（实测会主动来的有 `remoteControl/status/changed`、`thread/started`、`thread/status/changed`；还有 `turn/diff/updated`、`item/reasoning/textDelta`、`item/reasoning/summaryPartAdded`、`item/fileChange/patchUpdated`、`hook/*` 等）只进 transcript，不产出事件（接口 §3.1 规则 10）。

### 2.3 Hub 处理的服务端请求

`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`execCommandApproval`、`applyPatchApproval`。处理方式见 §6；其他服务端请求（`item/tool/call`、`attestation/generate`、`account/chatgptAuthTokens/refresh` 等）回 `-32601`。

## 3. 进程与握手

### 3.1 `CodexAdapter` 的状态与进程

`CodexAdapter` 持有：配置、`deps`、`proc`（当前进程：`ManagedProcess`、`JsonRpcConnection`、版本，或 `null`）、`starting`（正在启动的 Promise，保证同一时刻只启动一个）、`sessions: Map<threadId, CodexSession>`、缓存的能力与健康。

`ensureProcess()`：`proc` 存在且连接打开 → 直接用；`starting` 不为空 → 等它；否则启动（结束后把 `starting` 置空）：

| 步骤 | 动作                                                                                                                                                             | 失败                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `supervisor.resolveExecutable(config.command)`。                                                                                                                 | `null` → `AGENT_BINARY_NOT_FOUND`：“找不到 Codex 命令“<command>”：确认已安装 Codex CLI，或在设置页填写绝对路径”                                                                                |
| 2    | `supervisor.spawn({ command, args: config.args, cwd: os.homedir(), env: deps.agentEnv(), label: "codex:<agentId>", taskId: null })`。                            | `AGENT_SPAWN_FAILED`（supervisor 抛出）                                                                                                                                                        |
| 3    | `new JsonRpcConnection(stdout, stdin, { includeJsonrpcField: false, onRaw, onInvalidLine })`；挂上通知与服务端请求处理器；`exited.then(onProcessExit)`（§7.3）。 | —                                                                                                                                                                                              |
| 4    | `initialize`（30 秒）。                                                                                                                                          | 超时 → `AGENT_HANDSHAKE_TIMEOUT`；连接关闭（进程退出）→ `AGENT_SPAWN_FAILED`，`detail` 带退出码和脱敏后的 `stderrTail()`；JSON-RPC 错误 → `AGENT_PROTOCOL_ERROR`。三种情况都先 `terminate()`。 |
| 5    | 发 `initialized`；`version = parseCodexVersion(userAgent)`，`versionVerified = CODEX_VERIFIED_VERSIONS.includes(version)`。                                      | —                                                                                                                                                                                              |

**探测 `probe()`**：`ensureProcess()` → `account/read` → `model/list` 翻页 → 能力 = `{ models: normalizeCodexModels(全部页), modelsSource: 'agent', sandbox: true, resume: true, userVisibleSessions: true, workspaces: ['in_place', 'worktree'], fetchedAt }`；健康 = `account` 为 `null` 且 `requiresOpenaiAuth` 为 `true` → `auth_required`（“Codex 未登录：请在 ChatGPT 应用或终端里执行 codex login”），否则 `ready`（带 `version`、`versionVerified`、`executablePath`）。`AgentFailure` → `unavailable`（带错误码与说明）；其他异常 → `unavailable` + `AGENT_PROTOCOL_ERROR`。结果经 `deps.report` 上报并返回。实测：未登录时 `model/list` 照样返回模型列表。

收到 `account/updated` 通知（用户在别处登录或退出）→ 异步再 `probe()` 一次。

### 3.2 原始帧的归属

诊断开关打开时 transcript 按任务存放（接口 §6.3），共享进程的帧要分到各会话。`onRaw(direction, line)` 里解析一次 JSON（解析失败的行不归属）：

1. 有 `params.threadId` → 该 thread 的会话。
2. Hub 发出的请求：发送时记 `requestId → threadId`；收到对应响应时按它归属并删除记录。
3. Codex 发来的服务端请求：按 `params.threadId` 归属，同时记 `serverRequestId → threadId`，Hub 的回复按它归属。
4. 找不到会话的帧（握手、`account/read`、`model/list`、全局通知）只记 `debug` 日志（截断到 2 KB）。

## 4. 会话

### 4.1 `startSession(params, sink)`

| 步骤 | 动作                                                                                                                                                                                              | 失败                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1    | `ensureProcess()`。                                                                                                                                                                               | 原样抛出 `AgentFailure`                                                                             |
| 2    | `account/read`：`account === null && requiresOpenaiAuth` → 上报健康 `auth_required`，**不建 thread**（D32）。                                                                                     | `AGENT_AUTH_REQUIRED`：“Codex 未登录或登录已过期：请在 ChatGPT 应用或终端里执行 codex login 后重试” |
| 3a   | 新建：`thread/start { cwd, approvalPolicy: "on-request", sandbox, serviceName: "agent_hub", developerInstructions: CODEX_DEVELOPER_INSTRUCTIONS }`，`userVisible` 时再加 `threadSource: "user"`。 | JSON-RPC 错误 → `AGENT_PROTOCOL_ERROR`（`detail` 带 `code`、`message`）                             |
| 3b   | 恢复（`resumeNativeSessionId` 有值）：`thread/resume { threadId, cwd, approvalPolicy: "on-request", sandbox, developerInstructions, excludeTurns: true }`。                                       | JSON-RPC 错误 → `SESSION_NOT_RESUMABLE`：“Codex 无法恢复会话：<message>”                            |
| 4    | 用响应里的 `thread.id` 建 `CodexSession`，放进 `sessions`。                                                                                                                                       | —                                                                                                   |
| 5    | `params.signal` 已中止 → `thread/unsubscribe`（忽略错误），移出 `sessions`，抛错（接口 §6.1 规则 2）。                                                                                            | —                                                                                                   |
| 6    | `sink.emit({ type: 'session.started', nativeSessionId: thread.id, model: response.model, resumed })`；健康不是 `ready` 时上报 `ready`。                                                           | —                                                                                                   |

- 第 1–3 步任何一步遇到请求超时 → `AGENT_PROTOCOL_ERROR`；遇到连接关闭 → `AGENT_PROCESS_EXITED`（任务记 `failed`，接口 §4）。
- `sandbox` 取 `sandboxFor(mode, cwd).sandbox`。恢复时也要传 `sandbox` 和 `developerInstructions`：恢复后的 thread 不一定沿用旧值。
- 建 thread 的响应与紧随其后的 `thread/started` 通知可能在同一个数据块里，后者会在会话登记前被处理；它本来就被忽略，没有影响。

### 4.2 沙箱、网络与开发者指令

| 任务模式    | `thread/start.sandbox` | 每轮 `turn/start.sandboxPolicy`                                                                                              |
| ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `read_only` | `read-only`            | `{ type: "readOnly", networkAccess: false }`                                                                                 |
| `write`     | `workspace-write`      | `{ type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }` |

- 网络每轮都显式关闭（D30）：Agent 需要联网时会发权限申请，由人审批（§6）。
- `developerInstructions` = `CODEX_DEVELOPER_INSTRUCTIONS`（§9）：不推送、不改 remote、不碰凭据文件。这只是提示，真正的防线是推送守卫（[security.md](security.md) §3）。
- Hub 不传 `danger-full-access`，也不提供任何改沙箱的入口。实测：传错 `sandbox` 值时 Codex 返回 `-32600`。

### 4.3 每轮的模型与推理档位

Codex 的 `turn/start.model` / `effort` 是“本轮及以后各轮”的覆盖（生成类型的注释原文：“Override the model for this turn and subsequent turns”）。所以 Hub **每轮都显式传**由 `resolveTurnModel(models, model, effort)` 算出的值，避免上一轮的覆盖残留到这一轮：

| 轮的 `model`             | 轮的 `reasoningEffort` | 传给 `turn/start`                                                 |
| ------------------------ | ---------------------- | ----------------------------------------------------------------- |
| 有值                     | 有值                   | `model`、`effort` 原样                                            |
| 有值                     | `null`                 | `model`；`effort` = 该模型的 `defaultReasoningEffort`             |
| `null`                   | 任意                   | `model` = `isDefault` 的模型；`effort` = 给定值或该模型的默认档位 |
| 模型列表为空（探测失败） | 任意                   | 不传 `model`；有 `effort` 就只传 `effort`                         |

模型在任务创建 / 追问时已按 `model/list` 校验过（[local-api.md](local-api.md) §5.2）。

## 5. 一轮

### 5.1 `prompt(input)`

`CodexSession` 同一时刻最多一个活动轮，记录：Hub 的 `turnId`、Codex 的 `nativeTurnId`（开始为 `null`）、`fatal`（本轮的致命错误）、`cancelRequested`、未结束的 item（工具 item 与已收到增量的消息 / 推理 item，后者累计文本）、本轮的未决审批。

| 步骤 | 动作                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 会话已关闭 → 立即返回 `{ stopReason: 'error', error: AGENT_PROCESS_EXITED }`。                                                                                               |
| 2    | 建活动轮；创建 `prompt()` 的 Promise（由 §5.4 的“结束本轮”resolve）。                                                                                                        |
| 3    | `turn/start { threadId, input: [{ type: "text", text, text_elements: [] }], cwd, approvalPolicy: "on-request", sandboxPolicy, ...resolveTurnModel(...), summary: "auto" }`。 |
| 4    | 响应到达：`nativeTurnId ??= response.turn.id`；`cancelRequested` 为真 → 立即 `turn/interrupt`。本轮已经结束（`turn/completed` 比响应先处理）→ 什么都不做。                   |
| 5    | 请求失败：JSON-RPC 错误或超时 → 结束本轮，`AGENT_PROTOCOL_ERROR`（“Codex 拒绝了本轮请求：<message>”）；连接关闭 → 等 §7.3 的进程退出处理结束本轮。                           |

**轮的归属**：通知里的 `turnId`（或 `turn.id`）与 `nativeTurnId` 不同 → 忽略（记 `debug`）。`nativeTurnId` 还是 `null` 时，第一个带 `turnId` 的通知（通常是 `turn/started`）确定它。这样 `turn/start` 的响应与本轮最早的通知谁先被处理都没关系。没有活动轮时收到的轮内通知一律忽略。

### 5.2 通知到事件

| Codex                               | Hub 事件                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turn/started`                      | 无（确定 `nativeTurnId`；`turn.started` 由核心产出）。                                                                                                                                                                             |
| `item/started`                      | `mapItemStarted(item)`：命令、文件修改、MCP、动态工具、网页搜索、查看图片 → `tool.started`。`fileChange` 另外记下 `itemId → paths`（§6 用）。`userMessage`、`agentMessage`、`reasoning` 等 → 无。                                  |
| `item/completed`                    | `mapItemCompleted(item)`：`agentMessage` → `message.completed`；`reasoning` → `reasoning.completed`（摘要以空行连接，为空时不发）；工具 → `tool.completed`；`contextCompaction` → `notice`（`CONTEXT_COMPACTED`）。其他类型 → 无。 |
| `item/agentMessage/delta`           | `message.delta { itemId, text: delta }`                                                                                                                                                                                            |
| `item/reasoning/summaryTextDelta`   | `reasoning.delta { itemId, text: delta }`（只显示推理**摘要**；`item/reasoning/textDelta` 是原始推理，忽略）                                                                                                                       |
| `item/commandExecution/outputDelta` | `tool.output.delta { itemId, text: delta }`                                                                                                                                                                                        |
| `item/fileChange/outputDelta`       | `tool.output.delta`（0.164 已标为废弃、不再发送；保留处理无害）                                                                                                                                                                    |
| `turn/plan/updated`                 | `mapPlan` → `plan.updated`                                                                                                                                                                                                         |
| `thread/tokenUsage/updated`         | `usage.updated { usage: mapTokenUsage(n) }`（取 thread 累计值 `total`）                                                                                                                                                            |
| `turn/completed`                    | 结束本轮（§5.4）                                                                                                                                                                                                                   |

ThreadItem 一共 19 种（0.164.0）。Hub 映射 §8 里列出的 10 种，其余（`hookPrompt`、`functionCallOutput`、`plan`、`collabAgentToolCall`、`subAgentActivity`、`sleep`、`imageGeneration`、`enteredReviewMode`、`exitedReviewMode`）不产出事件。

### 5.3 错误、警告与改道

| 通知                                 | 处理                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`，`willRetry: true`，鉴权失败 | `isAuthFailure(error)` 为真：记 `fatal = mapTurnError(error)`（`AGENT_AUTH_REQUIRED`），上报健康 `auth_required`，立即 `turn/interrupt`。不等 Codex 重试 10 次（实测 WebSocket 5 次 + HTTPS 5 次，约 8 秒）。 |
| `error`，`willRetry: true`，其他     | `notice { level: 'warning', code: 'AGENT_RETRYING', message: "Codex 正在重试：<message>" }`。                                                                                                                 |
| `error`，`willRetry: false`          | 记 `fatal = mapTurnError(error)`；随后的 `turn/completed`（状态 `failed`）以它为准。                                                                                                                          |
| `warning`（带 `threadId`）           | `notice { level: 'warning', code: 'AGENT_WARNING', message: "Codex：<message>" }`。不带 `threadId` 的只记日志。                                                                                               |
| `model/rerouted`                     | `notice { level: 'warning', code: 'MODEL_REROUTED', message: "Codex 把本轮的模型从 <from> 换成了 <to>" }`。                                                                                                   |

`mapTurnError` 的分类见 §9 之后的表。

### 5.4 结束本轮

收到本轮的 `turn/completed`（或 §5.1 第 5 步、§7 的释放与退出）时，按顺序：

1. 结果：`turn/completed` → `mapTurnCompleted(turn, fatal)`：`completed` → `end_turn`；`interrupted` → `cancelled`；`failed` → `error`（`fatal` 优先，否则 `mapTurnError(turn.error)`）；有 `fatal` 且状态不是 `completed`（鉴权失败后被 Hub 中断）→ `error` + `fatal`。
2. 补齐（接口 §3.1 规则 4）：未结束的消息 / 推理 item 用累计文本补发 `message.completed` / `reasoning.completed`；未结束的工具 item 补发 `tool.completed { status: 'failed' }`。
3. 中止本轮全部未决审批的 `signal`（§6 的处理器随后回复 `cancel`）。
4. 清掉活动轮，resolve `prompt()`。

## 6. 服务端请求与审批

服务端请求按 `params.threadId` 找会话。

| 请求                                                  | 有会话时                                                                                                 | 找不到会话（例如 Codex 子 Agent 的 thread） |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `item/commandExecution/requestApproval`               | `approvalForCommand(p)` → 等审批 → `{ decision: decisionToWire(d) }`                                     | `{ decision: "decline" }`                   |
| `item/fileChange/requestApproval`                     | `approvalForFileChange(p, paths)`，`paths` 取自 §5.2 记下的同一 `itemId` → 等审批 → `{ decision }`       | `{ decision: "decline" }`                   |
| `item/permissions/requestApproval`                    | `approvalForPermissions(p)` → 等审批 → `permissionsResponse(p, d)`                                       | `{ permissions: {}, scope: "turn" }`        |
| `item/tool/requestUserInput`                          | `{ answers: {} }` + `notice`（`USER_INPUT_UNSUPPORTED`，“Codex 请求用户输入，Hub 暂不支持，已回空答案”） | 同左，不发 `notice`                         |
| `mcpServer/elicitation/request`                       | `{ action: "decline", content: null, _meta: null }` + `notice`（`ELICITATION_DECLINED`）                 | 同左，不发 `notice`                         |
| `execCommandApproval`、`applyPatchApproval`（旧接口） | `{ decision: "abort" }`                                                                                  | 同左                                        |
| 其他                                                  | `-32601`                                                                                                 | `-32601`                                    |

**等审批**：会话为该请求建一个 `AbortController`，登记在“请求 id → { controller, resolvedByServer }”表里，调用 `sink.requestApproval(input, controller.signal)`：

- 结果是 `{ decision }` → 按上表回复。决定是 `cancel_turn` 时回复 `cancel`，核心随后取消本轮（接口 §5.1）。
- 收到 `serverRequest/resolved { requestId }`（Codex 自己撤回了请求，例如轮已结束）→ 标记 `resolvedByServer` 并中止 `signal`；结果 `{ withdrawn: true }` → 处理器返回 `NO_RESPONSE`，**不回复**。
- 本轮结束、`cancelTurn`、`dispose` 时中止 `signal`；结果 `{ withdrawn: true }` 且不是 `resolvedByServer` → 回复 `{ decision: "cancel" }`（权限申请回复 `{ permissions: {}, scope: "turn" }`）；连接已关闭则回复被静默丢弃。
- 处理器返回后从表里删除该项。

Codex 的子 Agent（`collabAgentToolCall`）会建自己的 thread，那些 thread 不属于任何任务，审批一律拒绝；这是 v1 的已知限制。

## 7. 取消、释放与进程退出

### 7.1 `cancelTurn()`

没有活动轮 → 什么都不做。`nativeTurnId` 已知 → 发 `turn/interrupt { threadId, turnId }`，不等响应（失败记日志）；未知 → 记 `cancelRequested`，在 §5.1 第 4 步或第一个带 `turnId` 的通知到来时补发。Codex 收到中断后回 `{}`，随后发 `turn/completed`（状态 `interrupted`），本轮以 `cancelled` 结束。

### 7.2 `dispose(reason)`

幂等（重复调用返回同一个 Promise）：

1. 有活动轮：连接还开着且 `nativeTurnId` 已知 → 发 `turn/interrupt`（不等）；按接口 §6.1 规则 5 的表直接结束本轮。
2. 中止全部未决审批的 `signal`。
3. 连接还开着 → `thread/unsubscribe`（5 秒，失败只记日志；实测返回 `{ status: "unsubscribed" }`）。
4. 移出 `sessions`；resolve `closed`。

释放只退订 thread，**不结束共享进程**。`dispose('idle')` 由 `TaskRunner` 在任务闲置满 `idleTimeoutMinutes`（默认 30 分钟）后调用。

### 7.3 进程退出与 `thread/closed`

`exited` resolve 时（且是当前进程）：关闭连接，`proc = null`；对每个会话 `dispose('agent_exited')`（进行中的轮以 `AGENT_PROCESS_EXITED` 结束，任务记 `interrupted`）；不在停机中时上报健康 `unavailable`（`AGENT_PROCESS_EXITED`，“Codex 进程已退出（退出码 <code>），下次使用时自动重启”），并记 `warn` 日志（带脱敏后的 `stderrTail()`）。**不自动重启**：下一次 `startSession` 或 `probe()` 时 `ensureProcess()` 重新启动，成功后健康回到 `ready`。

收到某个 thread 的 `thread/closed`：该会话按 `agent_exited` 处理（只影响这一个任务）。

### 7.4 `shutdown()`

对全部会话并行 `dispose('shutdown')`，然后 `proc.managed.terminate(SHUTDOWN_TERMINATE)`。实测关闭 stdin 后 Codex 12 毫秒内退出（退出码 0）。之后再调用 `startSession` 抛 `AgentFailure`（`HUB_SHUTDOWN`）。

## 8. 协议类型

```ts
// server/src/adapters/codex/protocol.ts
/**
 * codex app-server 协议的手写子集（D33），按 codex-cli 0.164.0 生成的类型核对。
 * 只包含 Hub 发出的请求、Hub 处理的通知与服务端请求；字段名、取值与线上完全一致。
 * 线上的帧不带 "jsonrpc" 字段。
 */

export const CODEX_VERIFIED_VERSIONS = ['0.164.0'] as const;

/** Hub 只会发出这些方法（§2）；其余一律在发送前拒绝。 */
export const CODEX_CLIENT_METHODS = [
  'initialize',
  'initialized',
  'account/read',
  'model/list',
  'thread/start',
  'thread/resume',
  'thread/unsubscribe',
  'turn/start',
  'turn/interrupt',
] as const;
export type CodexClientMethod = (typeof CODEX_CLIENT_METHODS)[number];

// ---- 握手 ----

export interface InitializeParams {
  clientInfo: { name: string; title: string | null; version: string };
  capabilities: { experimentalApi: boolean; requestAttestation: boolean };
}

export interface InitializeResponse {
  /** 例如 "agent_hub/0.164.0 (Mac OS 15.1.0; arm64) …"；斜杠后的语义化版本就是 Codex 版本。 */
  userAgent: string;
  platformFamily: string;
  platformOs: string;
}

// ---- 账号与模型 ----

export interface GetAccountParams {
  refreshToken?: boolean;
}

export interface GetAccountResponse {
  account: { type: string } | null;
  requiresOpenaiAuth: boolean;
}

export interface ModelListParams {
  cursor?: string | null;
  includeHidden?: boolean | null;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string;
}

export interface ModelListResponse {
  data: CodexModel[];
  nextCursor: string | null;
}

// ---- 会话 ----

export type SandboxMode = 'read-only' | 'workspace-write';
export type AskForApproval = 'on-request';

export type SandboxPolicy =
  | { type: 'readOnly'; networkAccess: boolean }
  | {
      type: 'workspaceWrite';
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

export interface ThreadStartParams {
  cwd: string;
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
  serviceName: string;
  developerInstructions: string;
  /** D31：userVisible 时为 "user"，否则不带这个字段。 */
  threadSource?: string;
}

export interface ThreadResumeParams {
  threadId: string;
  cwd: string;
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
  developerInstructions: string;
  /** 不要整段历史，历史在 Hub 自己的事件库里。 */
  excludeTurns: boolean;
}

export interface CodexThread {
  id: string;
  model: string | null;
  reasoningEffort: string | null;
}

export interface ThreadStartResponse {
  thread: CodexThread;
  model: string;
  reasoningEffort: string | null;
}
export type ThreadResumeResponse = ThreadStartResponse;

export interface ThreadUnsubscribeParams {
  threadId: string;
}

// ---- 轮 ----

export interface TextInput {
  type: 'text';
  text: string;
  /** 必填，Hub 总是传空数组。 */
  text_elements: [];
}

export interface TurnStartParams {
  threadId: string;
  input: TextInput[];
  cwd: string;
  approvalPolicy: AskForApproval;
  sandboxPolicy: SandboxPolicy;
  model?: string;
  effort?: string;
  summary: 'auto';
}

export type CodexErrorInfo =
  | string
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { [key: string]: unknown };

export interface TurnError {
  message: string;
  codexErrorInfo: CodexErrorInfo | null;
  additionalDetails: string | null;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface CodexTurn {
  id: string;
  status: TurnStatus;
  error: TurnError | null;
}

export interface TurnStartResponse {
  turn: CodexTurn;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

// ---- item ----

export type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export interface FileUpdateChange {
  path: string;
  kind: { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null };
}

/** Hub 处理的 item；其他 type 的 item 也会到达，按未知处理（§5）。 */
export type ThreadItem =
  | { type: 'userMessage'; id: string }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      cwd: string;
      status: ItemStatus;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: ItemStatus }
  | {
      type: 'mcpToolCall';
      id: string;
      server: string;
      tool: string;
      status: 'inProgress' | 'completed' | 'failed';
      durationMs: number | null;
    }
  | {
      type: 'dynamicToolCall';
      id: string;
      tool: string;
      status: 'inProgress' | 'completed' | 'failed';
      durationMs: number | null;
    }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'imageView'; id: string; path: string }
  | { type: 'contextCompaction'; id: string };

// ---- 通知 ----

export interface ItemNotification {
  item: ThreadItem;
  threadId: string;
  turnId: string;
}

export interface DeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface TurnNotification {
  threadId: string;
  turn: CodexTurn;
}

export interface TurnPlanUpdatedNotification {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: { step: string; status: 'pending' | 'inProgress' | 'completed' }[];
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTokenUsageUpdatedNotification {
  threadId: string;
  turnId: string;
  tokenUsage: {
    total: TokenUsageBreakdown;
    last: TokenUsageBreakdown;
    modelContextWindow: number | null;
  };
}

export interface ErrorNotification {
  error: TurnError;
  willRetry: boolean;
  threadId: string;
  turnId: string;
}

export interface WarningNotification {
  threadId: string | null;
  message: string;
}

export interface ModelReroutedNotification {
  threadId: string;
  turnId: string;
  fromModel: string;
  toModel: string;
}

export interface ServerRequestResolvedNotification {
  threadId: string;
  requestId: string | number;
}

export interface ThreadClosedNotification {
  threadId: string;
}

// ---- 服务端请求 ----

export interface CommandExecutionRequestApprovalParams {
  kind: 'command' | 'writeStdin';
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  networkApprovalContext?: { host: string; protocol: string } | null;
  command?: string | null;
  cwd?: string | null;
}

export interface FileChangeRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

/** Hub 只发这四种；会改 Codex 持久策略的 amendment 类决定不发。 */
export type ApprovalDecisionWire = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export interface ApprovalDecisionResponse {
  decision: ApprovalDecisionWire;
}

export interface PermissionProfile {
  network?: { enabled: boolean | null };
  fileSystem?: { read: string[] | null; write: string[] | null };
}

export interface PermissionsRequestApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string;
  reason: string | null;
  permissions: {
    network: { enabled: boolean | null } | null;
    fileSystem: { read: string[] | null; write: string[] | null } | null;
  };
}

export interface PermissionsRequestApprovalResponse {
  permissions: PermissionProfile;
  scope: 'turn' | 'session';
}

export interface ToolRequestUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

export interface McpServerElicitationRequestResponse {
  action: 'decline';
  content: null;
  _meta: null;
}

/** 旧版接口（execCommandApproval、applyPatchApproval）的回复。 */
export interface LegacyApprovalResponse {
  decision: 'abort';
}
```

## 9. 映射函数

```ts
// server/src/adapters/codex/mapping.ts
import {
  reasoningEffortLabel,
  type AgentError,
  type AgentEvent,
  type ApprovalDecision,
  type ModelOption,
  type TaskMode,
  type UsageInfo,
} from '@agent-hub/contract';
import { agentError, toJsonValue, type ApprovalRequestInput, type TurnResult } from '../types';
import type {
  ApprovalDecisionWire,
  CodexErrorInfo,
  CodexModel,
  CodexTurn,
  CommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  SandboxMode,
  SandboxPolicy,
  ThreadItem,
  ThreadTokenUsageUpdatedNotification,
  TurnError,
  TurnPlanUpdatedNotification,
} from './protocol';

export const CODEX_DEVELOPER_INSTRUCTIONS =
  '你在 Agent Hub 派发的任务中运行。不要执行 git push，不要修改 git remote 配置，' +
  '不要读取或输出凭据文件（例如 ~/.ssh、~/.netrc、.env）。';

export const ALL_DECISIONS: ApprovalDecision[] = [
  'allow_once',
  'allow_for_session',
  'reject',
  'cancel_turn',
];

/** "agent_hub/0.164.0 (Mac OS 15.1.0; arm64) …" → "0.164.0"。 */
export function parseCodexVersion(userAgent: string): string | null {
  return /^[^/\s]+\/(\d+\.\d+\.\d+[^\s(]*)/.exec(userAgent)?.[1] ?? null;
}

export function sandboxFor(
  mode: TaskMode,
  cwd: string,
): { sandbox: SandboxMode; sandboxPolicy: SandboxPolicy } {
  if (mode === 'read_only') {
    return {
      sandbox: 'read-only',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    };
  }
  return {
    sandbox: 'workspace-write',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

/** 隐藏的模型不列出；id 用 model 字段（turn/start.model 接受的值）。 */
export function normalizeCodexModels(models: CodexModel[]): ModelOption[] {
  const seen = new Set<string>();
  const options: ModelOption[] = [];
  for (const m of models) {
    if (m.hidden || seen.has(m.model)) continue;
    seen.add(m.model);
    options.push({
      id: m.model,
      label: m.displayName || m.model,
      description: m.description || undefined,
      isDefault: m.isDefault,
      reasoningEfforts: m.supportedReasoningEfforts.map((e) => ({
        id: e.reasoningEffort,
        label: reasoningEffortLabel(e.reasoningEffort),
        description: e.description || undefined,
      })),
      defaultReasoningEffort: m.defaultReasoningEffort || null,
    });
  }
  return options;
}

/**
 * turn/start 的 model / effort：明确传值，避免上一轮的覆盖残留（§4.3）。
 * 用户没选时用默认模型（isDefault）及其默认档位；模型列表还没拿到时不传。
 */
export function resolveTurnModel(
  models: ModelOption[],
  model: string | null,
  effort: string | null,
): { model?: string; effort?: string } {
  const chosen = model ?? models.find((m) => m.isDefault)?.id;
  if (!chosen) return effort ? { effort } : {};
  const option = models.find((m) => m.id === chosen);
  const resolvedEffort = effort ?? option?.defaultReasoningEffort ?? undefined;
  return resolvedEffort ? { model: chosen, effort: resolvedEffort } : { model: chosen };
}

export function mapItemStarted(item: ThreadItem): AgentEvent | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'command',
        title: '执行命令',
        command: item.command,
        cwd: item.cwd,
      };
    case 'fileChange':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'edit',
        title: `修改 ${item.changes.length} 个文件`,
        paths: item.changes.map((c) => c.path),
      };
    case 'mcpToolCall':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'mcp',
        title: `MCP：${item.server}/${item.tool}`,
      };
    case 'dynamicToolCall':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'other',
        title: `工具：${item.tool}`,
      };
    case 'webSearch':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'fetch',
        title: item.query ? `网页搜索：${item.query}` : '网页搜索',
      };
    case 'imageView':
      return {
        type: 'tool.started',
        itemId: item.id,
        toolKind: 'read',
        title: '查看图片',
        paths: [item.path],
      };
    default:
      return null;
  }
}

export function mapItemCompleted(item: ThreadItem): AgentEvent | null {
  switch (item.type) {
    case 'agentMessage':
      return { type: 'message.completed', itemId: item.id, text: item.text };
    case 'reasoning': {
      const text = item.summary.join('\n\n');
      return text ? { type: 'reasoning.completed', itemId: item.id, text } : null;
    }
    case 'commandExecution':
      return {
        type: 'tool.completed',
        itemId: item.id,
        status: toolStatus(item.status),
        ...(item.exitCode === null ? {} : { exitCode: item.exitCode }),
        ...(item.durationMs === null ? {} : { durationMs: item.durationMs }),
      };
    case 'fileChange':
      return {
        type: 'tool.completed',
        itemId: item.id,
        status: toolStatus(item.status),
      };
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return {
        type: 'tool.completed',
        itemId: item.id,
        status: item.status === 'failed' ? 'failed' : 'completed',
        ...(item.durationMs === null ? {} : { durationMs: item.durationMs }),
      };
    case 'webSearch':
    case 'imageView':
      return { type: 'tool.completed', itemId: item.id, status: 'completed' };
    case 'contextCompaction':
      return {
        type: 'notice',
        level: 'info',
        code: 'CONTEXT_COMPACTED',
        message: 'Codex 压缩了会话上下文',
      };
    default:
      return null;
  }
}

function toolStatus(status: string): 'completed' | 'failed' | 'declined' {
  return status === 'failed' ? 'failed' : status === 'declined' ? 'declined' : 'completed';
}

export function mapPlan(n: TurnPlanUpdatedNotification): AgentEvent {
  return {
    type: 'plan.updated',
    explanation: n.explanation,
    entries: n.plan.map((p) => ({
      step: p.step,
      status: p.status === 'inProgress' ? 'in_progress' : p.status,
    })),
  };
}

/** Codex 报的是整个 thread 的累计用量。 */
export function mapTokenUsage(n: ThreadTokenUsageUpdatedNotification): UsageInfo {
  const t = n.tokenUsage.total;
  const usage: UsageInfo = {
    inputTokens: t.inputTokens,
    cachedInputTokens: t.cachedInputTokens,
    outputTokens: t.outputTokens,
    reasoningOutputTokens: t.reasoningOutputTokens,
    totalTokens: t.totalTokens,
  };
  if (n.tokenUsage.modelContextWindow !== null)
    usage.contextWindow = n.tokenUsage.modelContextWindow;
  return usage;
}

function errorInfoKey(info: CodexErrorInfo | null): {
  key: string | null;
  httpStatus: number | null;
} {
  if (info === null) return { key: null, httpStatus: null };
  if (typeof info === 'string') return { key: info, httpStatus: null };
  const key = Object.keys(info)[0] ?? null;
  const inner = key ? (info as Record<string, unknown>)[key] : null;
  const status =
    inner && typeof inner === 'object'
      ? (inner as { httpStatusCode?: unknown }).httpStatusCode
      : null;
  return { key, httpStatus: typeof status === 'number' ? status : null };
}

/** 鉴权失败（401）：重试也没用，适配器应立即中断本轮（§5.3）。 */
export function isAuthFailure(error: TurnError): boolean {
  const { key, httpStatus } = errorInfoKey(error.codexErrorInfo);
  return key === 'unauthorized' || httpStatus === 401;
}

const RETRYABLE_UPSTREAM = new Set([
  'serverOverloaded',
  'internalServerError',
  'flexUnavailable',
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
]);

export function mapTurnError(error: TurnError | null): AgentError {
  if (!error) return agentError('AGENT_UPSTREAM_ERROR', 'Codex 报告本轮失败，没有给出原因', true);
  const { key, httpStatus } = errorInfoKey(error.codexErrorInfo);
  const detail = toJsonValue({
    codexErrorInfo: error.codexErrorInfo,
    additionalDetails: error.additionalDetails,
  });
  const msg = `Codex：${error.message}`;
  if (key === 'unauthorized' || httpStatus === 401) {
    return agentError(
      'AGENT_AUTH_REQUIRED',
      'Codex 未登录或登录已过期：请在 ChatGPT 应用或终端里执行 codex login 后重试',
      false,
      detail,
    );
  }
  if (
    key === 'usageLimitExceeded' ||
    key === 'rateLimitExceeded' ||
    key === 'sessionBudgetExceeded' ||
    httpStatus === 429
  ) {
    return agentError('AGENT_RATE_LIMITED', msg, true, detail);
  }
  if (key === 'contextWindowExceeded')
    return agentError('AGENT_CONTEXT_EXCEEDED', msg, false, detail);
  if (key === 'sandboxError') return agentError('AGENT_SANDBOX_ERROR', msg, false, detail);
  return agentError(
    'AGENT_UPSTREAM_ERROR',
    msg,
    key !== null && RETRYABLE_UPSTREAM.has(key),
    detail,
  );
}

/**
 * turn/completed → TurnResult。fatal 是本轮记下的致命错误（willRetry 为 false 的 error 通知，
 * 或适配器因鉴权失败主动中断）；有 fatal 时即使 status 是 interrupted 也按失败处理。
 */
export function mapTurnCompleted(turn: CodexTurn, fatal: AgentError | null): TurnResult {
  if (fatal && turn.status !== 'completed') {
    return { stopReason: 'error', error: fatal, nativeTurnId: turn.id };
  }
  switch (turn.status) {
    case 'completed':
      return { stopReason: 'end_turn', nativeTurnId: turn.id };
    case 'interrupted':
      return { stopReason: 'cancelled', nativeTurnId: turn.id };
    default:
      return {
        stopReason: 'error',
        error: mapTurnError(turn.error),
        nativeTurnId: turn.id,
      };
  }
}

export function decisionToWire(decision: ApprovalDecision): ApprovalDecisionWire {
  switch (decision) {
    case 'allow_once':
      return 'accept';
    case 'allow_for_session':
      return 'acceptForSession';
    case 'reject':
      return 'decline';
    case 'cancel_turn':
      return 'cancel';
  }
}

export function approvalForCommand(p: CommandExecutionRequestApprovalParams): ApprovalRequestInput {
  const network = p.networkApprovalContext ?? null;
  const input: ApprovalRequestInput = {
    kind: network ? 'network' : 'command',
    title: network
      ? `访问网络：${network.host}`
      : p.kind === 'writeStdin'
        ? '向进程写入输入'
        : '执行命令',
    options: ALL_DECISIONS,
    detail: toJsonValue(p),
  };
  if (p.command) input.command = p.command;
  if (p.cwd) input.cwd = p.cwd;
  if (p.reason) input.reason = p.reason;
  return input;
}

/** paths 取自同一 itemId 的 fileChange item（item/started 时记下）。 */
export function approvalForFileChange(
  p: FileChangeRequestApprovalParams,
  paths: string[] | undefined,
): ApprovalRequestInput {
  const input: ApprovalRequestInput = {
    kind: 'file_change',
    title: p.grantRoot
      ? `授予目录写权限：${p.grantRoot}`
      : paths?.length
        ? `修改 ${paths.length} 个文件`
        : '修改文件',
    options: ALL_DECISIONS,
    detail: toJsonValue(p),
  };
  if (paths?.length) input.paths = paths;
  if (p.reason) input.reason = p.reason;
  return input;
}

export function approvalForPermissions(p: PermissionsRequestApprovalParams): ApprovalRequestInput {
  const fs = p.permissions.fileSystem;
  const paths = [...(fs?.read ?? []), ...(fs?.write ?? [])];
  const input: ApprovalRequestInput = {
    kind: p.permissions.network?.enabled ? 'network' : 'other',
    title: p.permissions.network?.enabled ? '申请联网权限' : '申请额外的文件权限',
    cwd: p.cwd,
    options: ALL_DECISIONS,
    detail: toJsonValue(p),
  };
  if (paths.length) input.paths = paths;
  if (p.reason) input.reason = p.reason;
  return input;
}

export function permissionsResponse(
  p: PermissionsRequestApprovalParams,
  decision: ApprovalDecision,
): PermissionsRequestApprovalResponse {
  if (decision === 'reject' || decision === 'cancel_turn')
    return { permissions: {}, scope: 'turn' };
  const granted: PermissionsRequestApprovalResponse['permissions'] = {};
  if (p.permissions.network) granted.network = p.permissions.network;
  if (p.permissions.fileSystem) granted.fileSystem = p.permissions.fileSystem;
  return {
    permissions: granted,
    scope: decision === 'allow_for_session' ? 'session' : 'turn',
  };
}
```

`mapTurnError` 的分类（`codexErrorInfo` 是字符串，或只有一个键的对象，键名即类别；对象里的 `httpStatusCode` 也参与判断）：

| 条件                                                                           | 错误码                   | `retryable`                             |
| ------------------------------------------------------------------------------ | ------------------------ | --------------------------------------- |
| `unauthorized` 或 HTTP 401                                                     | `AGENT_AUTH_REQUIRED`    | `false`                                 |
| `usageLimitExceeded`、`rateLimitExceeded`、`sessionBudgetExceeded` 或 HTTP 429 | `AGENT_RATE_LIMITED`     | `true`                                  |
| `contextWindowExceeded`                                                        | `AGENT_CONTEXT_EXCEEDED` | `false`                                 |
| `sandboxError`                                                                 | `AGENT_SANDBOX_ERROR`    | `false`                                 |
| 其他（含 `codexErrorInfo` 为 `null`）                                          | `AGENT_UPSTREAM_ERROR`   | 类别在 `RETRYABLE_UPSTREAM` 里时 `true` |

`message` 为“Codex：<原始 message>”（鉴权失败用固定的中文提示），`detail` 为 `{ codexErrorInfo, additionalDetails }`。

## 10. 帧示例

摘自 0.164.0 的实测记录（`->` Hub 发出，`<-` Codex 发来；长字段用 `…` 省略，路径与 id 已替换）。探测脚本当时没带 `threadSource`、`model`、`effort`，这里按 Hub 的实际参数补上了，其余字段与记录一致。通知帧顶层还有一个 `emittedAtMs` 字段，Hub 忽略。

```text
-> {"method":"initialize","id":0,"params":{"clientInfo":{"name":"agent_hub","title":"Agent Hub","version":"0.1.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}
<- {"id":0,"result":{"userAgent":"agent_hub/0.164.0 (Mac OS 15.1.0; arm64) … (agent_hub; 0.1.0)","codexHome":"<CODEX_HOME>","platformFamily":"unix","platformOs":"macos"}}
<- {"method":"remoteControl/status/changed","params":{"status":"disabled",…},"emittedAtMs":…}
-> {"method":"initialized"}
-> {"method":"account/read","id":1,"params":{"refreshToken":false}}
<- {"id":1,"result":{"account":null,"requiresOpenaiAuth":true,"workspaceRouting":null}}
-> {"method":"thread/start","id":3,"params":{"cwd":"<repo>","approvalPolicy":"on-request","sandbox":"read-only","serviceName":"agent_hub","developerInstructions":"…","threadSource":"user"}}
<- {"id":3,"result":{"thread":{"id":"<thread>",…,"model":"<model>","reasoningEffort":null,…},"model":"<model>",…}}
-> {"method":"turn/start","id":4,"params":{"threadId":"<thread>","input":[{"type":"text","text":"say hi","text_elements":[]}],"cwd":"<repo>","approvalPolicy":"on-request","sandboxPolicy":{"type":"readOnly","networkAccess":false},"model":"<model>","effort":"medium","summary":"auto"}}
<- {"id":4,"result":{"turn":{"id":"<turn>","items":[],"status":"inProgress","error":null,…}}}
<- {"method":"turn/started","params":{"threadId":"<thread>","turn":{"id":"<turn>","status":"inProgress",…}}}
<- {"method":"item/started","params":{"item":{"type":"userMessage","id":"…",…},"threadId":"<thread>","turnId":"<turn>",…}}
<- {"method":"error","params":{"error":{"message":"Reconnecting... 2/5","codexErrorInfo":{"responseStreamDisconnected":{"httpStatusCode":401}},"additionalDetails":"unexpected status 401 Unauthorized: …"},"willRetry":true,"threadId":"<thread>","turnId":"<turn>"}}
-> {"method":"turn/interrupt","id":5,"params":{"threadId":"<thread>","turnId":"<turn>"}}
<- {"id":5,"result":{}}
<- {"method":"turn/completed","params":{"threadId":"<thread>","turn":{"id":"<turn>","status":"interrupted","error":null,…}}}
-> {"method":"thread/unsubscribe","id":6,"params":{"threadId":"<thread>"}}
<- {"id":6,"result":{"status":"unsubscribed"}}
```

这段记录对应的流程：未登录 → 实测的 `account/read`；**按 D32，真实运行时第 2 步就会失败，不会走到 `thread/start`**。记录里保留后面的帧，是为了给出 `turn/start`、鉴权失败的 `error` 通知、中断与退订的真实形状。假 Codex 的场景文件照这些帧编写（[testing.md](testing.md) §3）。

## 11. 兼容性

### 11.1 兼容表

改了 `protocol.ts` 或升级 Codex 后更新本表；`CODEX_VERIFIED_VERSIONS` 与本表的“已验证”行保持一致。

| Codex 版本 | 日期       | 结论   | 验证内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.164.0    | 2026-10-27 | 已验证 | `protocol.ts` 与生成类型双向兼容（§11.2）；`userAgent` 形如 `agent_hub/0.164.0 (…)`；`initialize` 后会主动发 `remoteControl/status/changed`；未登录时 `account/read` 返回 `{ account: null, requiresOpenaiAuth: true }`、`model/list` 照常返回；未登录时 `thread/start` 也能成功，失败要等 `turn/start` 后的 5+5 次重连（`error` 通知 `willRetry: true`、HTTP 401）；`turn/interrupt` 回 `{}` 后发 `turn/completed`（`interrupted`）；`thread/unsubscribe` 回 `{ status: "unsubscribed" }`；非法 `sandbox` 值返回 `-32600`；关闭 stdin 后 12 毫秒退出。 |
| 0.164.0    | —          | 待人工 | 登录状态下的完整一轮（命令执行与文件修改审批、`serverRequest/resolved`、推理摘要增量、用量）；`threadSource: "user"` 的会话是否出现在 ChatGPT 应用里（R2）。按 [testing.md](testing.md) §7 的清单在 owner 的 Mac 上验证后改本行。                                                                                                                                                                                                                                                                                                                       |

`initialize` 返回的版本不在 `CODEX_VERIFIED_VERSIONS` 里时：照常使用，Agent 卡片显示“未验证的版本”（`versionVerified: false`）。

### 11.2 升级时的核对脚本（可选）

```ts
// server/scripts/codex-compat/check.ts
/**
 * 升级 Codex 时的可选核对（D33，不进 CI）：手写的 protocol.ts 与 codex 生成的类型双向兼容。
 *   codex app-server generate-ts --out scripts/codex-compat/generated
 *   pnpm exec tsc -p scripts/codex-compat/tsconfig.json
 * 编译通过 = 兼容；报错的那一行指出哪个类型对不上。generated/ 不提交。
 */
import type * as H from '../../src/adapters/codex/protocol';
import type { ClientRequest } from './generated/ClientRequest';
import type { ClientNotification } from './generated/ClientNotification';
import type { ServerNotification } from './generated/ServerNotification';
import type { ServerRequest } from './generated/ServerRequest';
import type { InitializeParams } from './generated/InitializeParams';
import type { InitializeResponse } from './generated/InitializeResponse';
import type { ExecCommandApprovalResponse } from './generated/ExecCommandApprovalResponse';
import type { ApplyPatchApprovalResponse } from './generated/ApplyPatchApprovalResponse';
import type * as G from './generated/v2/index';

type Assert<T extends true> = T;
type Sub<A, B> = [A] extends [B] ? true : false;

// Hub 发出的东西：手写类型必须能赋给生成类型
type _s1 = Assert<Sub<H.InitializeParams, InitializeParams>>;
type _s2 = Assert<Sub<H.GetAccountParams, G.GetAccountParams>>;
type _s3 = Assert<Sub<H.ModelListParams, G.ModelListParams>>;
type _s4 = Assert<Sub<H.ThreadStartParams, G.ThreadStartParams>>;
type _s5 = Assert<Sub<H.ThreadResumeParams, G.ThreadResumeParams>>;
type _s6 = Assert<Sub<H.ThreadUnsubscribeParams, G.ThreadUnsubscribeParams>>;
type _s7 = Assert<Sub<H.TurnStartParams, G.TurnStartParams>>;
type _s8 = Assert<Sub<H.TurnInterruptParams, G.TurnInterruptParams>>;
type _s9 = Assert<Sub<H.ApprovalDecisionResponse, G.CommandExecutionRequestApprovalResponse>>;
type _s10 = Assert<Sub<H.ApprovalDecisionResponse, G.FileChangeRequestApprovalResponse>>;
type _s11 = Assert<Sub<H.PermissionsRequestApprovalResponse, G.PermissionsRequestApprovalResponse>>;
type _s12 = Assert<Sub<H.ToolRequestUserInputResponse, G.ToolRequestUserInputResponse>>;
type _s13 = Assert<
  Sub<H.McpServerElicitationRequestResponse, G.McpServerElicitationRequestResponse>
>;
type _s14 = Assert<Sub<H.LegacyApprovalResponse, ExecCommandApprovalResponse>>;
type _s15 = Assert<Sub<H.LegacyApprovalResponse, ApplyPatchApprovalResponse>>;
type _s16 = Assert<Sub<Exclude<H.CodexClientMethod, 'initialized'>, ClientRequest['method']>>;
type _s17 = Assert<Sub<'initialized', ClientNotification['method']>>;
type _s18 = Assert<Sub<H.SandboxPolicy, G.SandboxPolicy>>;

// Hub 收到的东西：生成类型必须能赋给手写类型
type _r1 = Assert<Sub<InitializeResponse, H.InitializeResponse>>;
type _r2 = Assert<Sub<G.GetAccountResponse, H.GetAccountResponse>>;
type _r3 = Assert<Sub<G.ModelListResponse, H.ModelListResponse>>;
type _r4 = Assert<Sub<G.ThreadStartResponse, H.ThreadStartResponse>>;
type _r5 = Assert<Sub<G.ThreadResumeResponse, H.ThreadResumeResponse>>;
type _r6 = Assert<Sub<G.TurnStartResponse, H.TurnStartResponse>>;
type _r7 = Assert<Sub<Omit<G.ItemStartedNotification, 'item'>, Omit<H.ItemNotification, 'item'>>>;
type _r8 = Assert<Sub<Omit<G.ItemCompletedNotification, 'item'>, Omit<H.ItemNotification, 'item'>>>;
type HItem<T extends H.ThreadItem['type']> = Extract<H.ThreadItem, { type: T }>;
type GItem<T extends string> = Extract<G.ThreadItem, { type: T }>;
type _i1 = Assert<Sub<GItem<'userMessage'>, HItem<'userMessage'>>>;
type _i2 = Assert<Sub<GItem<'agentMessage'>, HItem<'agentMessage'>>>;
type _i3 = Assert<Sub<GItem<'reasoning'>, HItem<'reasoning'>>>;
type _i4 = Assert<Sub<GItem<'commandExecution'>, HItem<'commandExecution'>>>;
type _i5 = Assert<Sub<GItem<'fileChange'>, HItem<'fileChange'>>>;
type _i6 = Assert<Sub<GItem<'mcpToolCall'>, HItem<'mcpToolCall'>>>;
type _i7 = Assert<Sub<GItem<'dynamicToolCall'>, HItem<'dynamicToolCall'>>>;
type _i8 = Assert<Sub<GItem<'webSearch'>, HItem<'webSearch'>>>;
type _i9 = Assert<Sub<GItem<'imageView'>, HItem<'imageView'>>>;
type _i10 = Assert<Sub<GItem<'contextCompaction'>, HItem<'contextCompaction'>>>;
type _i11 = Assert<Sub<H.ThreadItem['type'], G.ThreadItem['type']>>;
type _r9 = Assert<Sub<G.AgentMessageDeltaNotification, H.DeltaNotification>>;
type _r10 = Assert<Sub<G.ReasoningSummaryTextDeltaNotification, H.DeltaNotification>>;
type _r11 = Assert<Sub<G.CommandExecutionOutputDeltaNotification, H.DeltaNotification>>;
type _r12 = Assert<Sub<G.FileChangeOutputDeltaNotification, H.DeltaNotification>>;
type _r13 = Assert<Sub<G.TurnStartedNotification, H.TurnNotification>>;
type _r14 = Assert<Sub<G.TurnCompletedNotification, H.TurnNotification>>;
type _r15 = Assert<Sub<G.TurnPlanUpdatedNotification, H.TurnPlanUpdatedNotification>>;
type _r16 = Assert<
  Sub<G.ThreadTokenUsageUpdatedNotification, H.ThreadTokenUsageUpdatedNotification>
>;
type _r17 = Assert<Sub<G.ErrorNotification, H.ErrorNotification>>;
type _r18 = Assert<Sub<G.WarningNotification, H.WarningNotification>>;
type _r19 = Assert<Sub<G.ModelReroutedNotification, H.ModelReroutedNotification>>;
type _r20 = Assert<Sub<G.ServerRequestResolvedNotification, H.ServerRequestResolvedNotification>>;
type _r21 = Assert<Sub<G.ThreadClosedNotification, H.ThreadClosedNotification>>;
type _r22 = Assert<
  Sub<G.CommandExecutionRequestApprovalParams, H.CommandExecutionRequestApprovalParams>
>;
type _r23 = Assert<Sub<G.FileChangeRequestApprovalParams, H.FileChangeRequestApprovalParams>>;
type _r24 = Assert<Sub<G.PermissionsRequestApprovalParams, H.PermissionsRequestApprovalParams>>;
type _r25 = Assert<Sub<G.CodexErrorInfo, H.CodexErrorInfo>>;
type _r26 = Assert<Sub<G.Model, H.CodexModel>>;

// 适配器处理的通知与服务端请求方法名都存在
type HandledNotifications =
  | 'item/started'
  | 'item/completed'
  | 'item/agentMessage/delta'
  | 'item/reasoning/summaryTextDelta'
  | 'item/commandExecution/outputDelta'
  | 'item/fileChange/outputDelta'
  | 'turn/started'
  | 'turn/completed'
  | 'turn/plan/updated'
  | 'thread/tokenUsage/updated'
  | 'error'
  | 'warning'
  | 'model/rerouted'
  | 'serverRequest/resolved'
  | 'thread/closed'
  | 'account/updated';
type _m1 = Assert<Sub<HandledNotifications, ServerNotification['method']>>;
type HandledRequests =
  | 'item/commandExecution/requestApproval'
  | 'item/fileChange/requestApproval'
  | 'item/permissions/requestApproval'
  | 'item/tool/requestUserInput'
  | 'mcpServer/elicitation/request'
  | 'execCommandApproval'
  | 'applyPatchApproval';
type _m2 = Assert<Sub<HandledRequests, ServerRequest['method']>>;
```

`server/scripts/codex-compat/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": [],
    "ignoreDeprecations": "6.0"
  },
  "files": ["check.ts"]
}
```

`server/.gitignore` 加一行 `scripts/codex-compat/generated/`。新版本核对通过后：把版本号加进 `CODEX_VERIFIED_VERSIONS`，在 §11.1 加一行，并按 [testing.md](testing.md) §7 跑一遍真实 Codex 的手工清单。核对失败时按报错修改 `protocol.ts`（只改用到的子集），再同步 `mapping.ts` 与假 Codex 的场景。
