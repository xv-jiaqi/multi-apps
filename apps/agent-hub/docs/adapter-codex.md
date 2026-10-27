# Codex 适配器（app-server JSON-RPC）

> 上级文档：[adapter-interface.md](adapter-interface.md)。本文写 `CodexAdapter` 怎么用 `codex app-server` 的协议实现统一接口。
>
> **以生成的类型为准**：公开文档和实际协议有出入（例如文档示例里 `thread/start.sandbox` 写的是 `"workspaceWrite"`，而 0.164.0 生成的类型是 `"workspace-write"`）。实现时一律以 `codex app-server generate-ts` 的产物为准，本文的取值来自 **codex-cli 0.164.0** 生成的类型（2026-10-27 核对）。

## 1. 版本与生成类型

- 用 `codex app-server generate-ts --out server/src/adapters/codex/generated` 生成类型，**提交进仓库**，同目录写 `VERSION` 文件记录生成时的 `codex --version`。脚本：`pnpm --filter @agent-hub/server codex:gen`。
- CI 不安装 Codex，只编译适配器对生成类型的使用；生成类型有破坏性变化时编译失败，这正是我们要的。
- 运行时：初始化时读取 `codex --version`，和 `VERSION` 不一致时发 `notice`（warning），不阻止使用；不认识的字段与通知照常忽略。
- 升级流程：本机装新版 → 重新生成 → 跑适配器测试 → 按 §12 手工验收 → 更新 §13 兼容表。

## 2. 进程与传输

| 项目         | 约定                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动命令     | `codex app-server`（默认 stdio 传输），可执行文件按登录 shell PATH 解析，或用配置里的绝对路径                                                                          |
| 进程模型     | 侧车内**一个共享进程**，每个任务一个 thread；按 `threadId` 把通知和服务端请求路由到对应任务                                                                            |
| 帧格式       | 每行一个 JSON；JSON-RPC 2.0 语义，但线上**省略** `"jsonrpc":"2.0"` 字段（发送时不要带，接收时不要求）                                                                  |
| 单行上限     | 64 MB（命令输出聚合可能很大）；超限视为协议错误，重启进程                                                                                                              |
| 写入背压     | `stdin.write()` 返回 `false` 时等 `drain`                                                                                                                              |
| stderr       | 逐行写侧车日志（`debug` 级别），不解析                                                                                                                                 |
| `CODEX_HOME` | 不设置，用默认的 `~/.codex`：要复用用户已有的登录，且 ChatGPT 应用里的 Codex 也读这里（会话可见性依赖它，见 §11）                                                      |
| 环境变量     | 只用 `StartSessionParams.env` 同源的清洗后环境（security.md §3.1、§4.2）。注意共享进程的环境在启动时就定了，所以推送守卫的环境变量必须对所有任务一致——它本来就是全局的 |

进程意外退出：所有 Codex 会话产出 `agent.exited`，进行中的 `prompt()` 以 `AGENT_CRASHED` 结束，任务记 `interrupted`；按 1 s / 5 s / 30 s 退避重启，之后可用 `thread/resume` 恢复。

## 3. 握手

```text
→ {"method":"initialize","id":0,"params":{"clientInfo":{"name":"agent_hub","title":"Agent Hub","version":"0.1.0"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}
← {"id":0,"result":{"userAgent":"…","platformFamily":"…","platformOs":"…"}}
→ {"method":"initialized"}
```

- `clientInfo.name` 用 `agent_hub`。OpenAI 用它在合规日志里识别客户端；面向企业的新集成需要联系 OpenAI 加入已知客户端列表——这是个人在公司机器上用，是否需要登记见待决问题 Q11。
- `capabilities.experimentalApi` 默认 `false`，只用稳定接口（服务端会拒绝实验性方法和字段）。下文用到的方法与字段都在稳定接口里。
- 可选：`capabilities.optOutNotificationMethods` 里列出不需要的通知（精确匹配），例如 `item/reasoning/textDelta`，减少流量。
- 握手超时 30 秒 → `AGENT_HANDSHAKE_TIMEOUT`。

## 4. 健康与登录

- `account/read`（`{"refreshToken":false}`）→ `{ account, requiresOpenaiAuth }`。`account` 为 `null` 且 `requiresOpenaiAuth` 为 `true` 时健康状态为 `auth_required`，提示“请在 ChatGPT 应用或终端执行 `codex login` 登录”。**Hub 不调用任何登录、登出方法。**
- 收到 `account/updated` 通知时重新检查健康状态并刷新模型缓存。
- 健康检查同时记录可执行文件绝对路径和 `codex --version`。

## 5. 模型与推理档位

- `model/list`（`{"includeHidden":false}`，有 `nextCursor` 就继续翻页）。每个 `Model` 映射为：

  | `ModelOption`            | 来源                                                                                           |
  | ------------------------ | ---------------------------------------------------------------------------------------------- |
  | `id`                     | `model.id`（传给 `thread/start.model` / `turn/start.model` 前实测确认与 `model.model` 的区别） |
  | `label`                  | `model.displayName`                                                                            |
  | `description`            | `model.description`                                                                            |
  | `isDefault`              | `model.isDefault`                                                                              |
  | `reasoningEfforts`       | `model.supportedReasoningEfforts[]` 的 `reasoningEffort` 与 `description`                      |
  | `defaultReasoningEffort` | `model.defaultReasoningEffort`                                                                 |

- 缓存 10 分钟；`modelsSource = 'probe'`。`model/list` 返回 `-32600` 且提示需要重启 Codex 时，重启共享进程（空闲时）后重试一次。
- 用户不选模型时不传 `model`，沿用其 Codex 配置里的默认值；`session.started` 事件里回填实际模型（`thread.model`、`thread.reasoningEffort`）。

## 6. 会话：`thread/start` / `thread/resume`

| `ThreadStartParams` 字段 | 取值                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`                    | `StartSessionParams.cwd`                                                                                                                            |
| `model`                  | 用户所选，未选则不传                                                                                                                                |
| `sandbox`                | 只读 → `"read-only"`；可写 → `"workspace-write"`。**永不发送** `"danger-full-access"`（代码里做白名单，单测覆盖）                                   |
| `approvalPolicy`         | 默认 `"on-request"`（模型需要越过沙箱时发审批请求给 Hub）。可配置为 `"untrusted"`（更严）。`"never"` 只允许用于只读任务                             |
| `threadSource`           | `userVisible` 为真时传 `"user"`，否则不传（见 §11）                                                                                                 |
| `serviceName`            | `"agent_hub"`                                                                                                                                       |
| `developerInstructions`  | Hub 追加的软约束：“你在 Agent Hub 派发的任务里运行；不要执行 git push、不要修改 git remote 配置、不要读取凭据文件。” 只是提醒，硬约束见 security.md |

- 响应里的 `thread.id` 就是 `nativeSessionId`，随后产出 `session.started`。
- 恢复：`thread/resume`（`{ threadId, cwd, sandbox, approvalPolicy, excludeTurns: true }`）。`excludeTurns: true` 避免返回整段历史（全量历史返回已被标记为废弃），历史由 Hub 自己的事件库提供。
- **不要**为同一个 thread 同时发起两轮；`turn/steer`（向进行中的轮追加输入）不在 M1–M5 范围内。

## 7. 轮：`turn/start`

| `TurnStartParams` 字段 | 取值                                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threadId`             | 会话的 thread id                                                                                                                                                                                         |
| `input`                | `[{ "type": "text", "text": "<提示词>", "text_elements": [] }]`（`text_elements` 是必填字段）；图片附件追加 `{ "type": "localImage", "path": "<绝对路径>" }`                                             |
| `cwd`                  | 同会话                                                                                                                                                                                                   |
| `approvalPolicy`       | 同会话                                                                                                                                                                                                   |
| `sandboxPolicy`        | 只读：`{ "type": "readOnly", "networkAccess": false }`；可写：`{ "type": "workspaceWrite", "writableRoots": ["<cwd>"], "networkAccess": false, "excludeTmpdirEnvVar": false, "excludeSlashTmp": false }` |
| `model` / `effort`     | 用户所选                                                                                                                                                                                                 |
| `summary`              | `"auto"`（让模型给出推理摘要，界面折叠显示）                                                                                                                                                             |

- 这些覆盖项会成为该 thread 之后各轮的默认值，所以**每一轮都发完整的一组**，避免上一轮的设置残留（例如上一轮是可写、这一轮被改成只读）。
- `networkAccess` 一律 `false`：沙箱内命令不能联网，这是防止 `git push` 的一层（security.md §3.3）。需要联网的命令会触发审批，由人决定。
- 响应里的 `turn.id` 用于产出 `turn.started` 和之后的 `turn/interrupt`。
- 本轮结束以 `turn/completed` 为准：

  | `turn.status` | `StopReason` | 说明                                        |
  | ------------- | ------------ | ------------------------------------------- |
  | `completed`   | `end_turn`   | 最后一条 `agentMessage` 记为 `finalMessage` |
  | `interrupted` | `cancelled`  | `turn/interrupt` 之后                       |
  | `failed`      | `error`      | `turn.error` 按下表映射为 `AgentError`      |

  | `codexErrorInfo`                                                                                                                               | `AgentErrorCode`         | `retryable` |
  | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------- |
  | `ContextWindowExceeded`                                                                                                                        | `AGENT_CONTEXT_EXCEEDED` | 否          |
  | `UsageLimitExceeded`                                                                                                                           | `AGENT_USAGE_LIMIT`      | 否          |
  | `Unauthorized`                                                                                                                                 | `AGENT_AUTH_REQUIRED`    | 否          |
  | `SandboxError`                                                                                                                                 | `AGENT_SANDBOX_ERROR`    | 否          |
  | `HttpConnectionFailed`、`ResponseStreamConnectionFailed`、`ResponseStreamDisconnected`、`ResponseTooManyFailedAttempts`、`InternalServerError` | `AGENT_UPSTREAM_ERROR`   | 是          |
  | `BadRequest`、`Other`、其他未知值                                                                                                              | `AGENT_UPSTREAM_ERROR`   | 否          |

  `message` 用 `turn.error.message`，原始 `codexErrorInfo`（含 `httpStatusCode`）放进 `detail`。

## 8. 事件映射

| Codex 通知                                          | 产出的 `AgentEvent`                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `turn/started`                                      | `turn.started`（若 `turn/start` 响应已产出则去重）                                  |
| `item/started`：`agentMessage`                      | 无（等增量）                                                                        |
| `item/agentMessage/delta`                           | `message.delta`                                                                     |
| `item/completed`：`agentMessage`                    | `message.completed`（以 `item.text` 为准，覆盖增量拼接结果）                        |
| `item/reasoning/summaryTextDelta`                   | `reasoning.delta`                                                                   |
| `item/completed`：`reasoning`                       | `reasoning.completed`（`summary` 拼接）                                             |
| `item/reasoning/textDelta`                          | 不产出（不展示原始推理）                                                            |
| `item/started`：`commandExecution`                  | `tool.started`（`toolKind: command`，带 `command`、`cwd`）                          |
| `item/commandExecution/outputDelta`                 | `tool.output`（`stream: stdout`，Codex 不区分 stdout / stderr）                     |
| `item/completed`：`commandExecution`                | `tool.completed`（`status`、`exitCode`、`durationMs`；被拒绝时 `declined`）         |
| `item/started` / `item/completed`：`fileChange`     | `tool.started`（`toolKind: edit`，`paths` 取自 `changes[].path`）/ `tool.completed` |
| `item/started` / `item/completed`：`mcpToolCall`    | `tool.started`（`toolKind: mcp`，标题 `server/tool`）/ `tool.completed`             |
| `item/started`：`webSearch`                         | `tool.started`（`toolKind: web`，标题为查询词）                                     |
| `item/completed`：`contextCompaction`               | `notice`（info：“Codex 压缩了上下文”）                                              |
| `turn/diff/updated`                                 | `diff.reported`（`patch` 为聚合 diff，`files` 由补丁解析）                          |
| `turn/plan/updated`                                 | `plan.updated`（`inProgress` → `in_progress`）                                      |
| `thread/tokenUsage/updated`                         | `usage.updated`                                                                     |
| `model/rerouted`                                    | `notice`（warning：“模型从 X 被改路由到 Y”）+ `config.updated`                      |
| `error`                                             | `error`（随后会有 `turn/completed` 且 `status: failed`）                            |
| `warning`、`configWarning`、`deprecationNotice`     | `notice`（warning）                                                                 |
| `serverRequest/resolved`                            | 若对应审批在 Hub 里仍是 `pending`：`approval.withdrawn`                             |
| `account/updated`                                   | 不产出任务事件；刷新健康状态                                                        |
| 其他（`thread/realtime/*`、`fuzzyFileSearch/*` 等） | 只写 transcript                                                                     |

## 9. 审批（服务端请求）

Codex 以 JSON-RPC **请求**（带 `id`）向 Hub 要决定，Hub 必须回复。

| 服务端请求                                                                            | `ApprovalRequest`                                                                                                                         | 回复                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `item/commandExecution/requestApproval`                                               | `kind: command`（`networkApprovalContext` 非空时为 `network`）；`command`、`cwd`、`reason`；`kind: "writeStdin"` 时标题为“向进程写入输入” | `{ "decision": "accept" \| "acceptForSession" \| "decline" \| "cancel" }` |
| `item/fileChange/requestApproval`                                                     | `kind: file_change`；`paths` 取同一 `itemId` 的 `fileChange` item；有 `grantRoot` 时标题为“授予目录写权限：<路径>”，界面醒目提示          | 同上（不含 amendment 类）                                                 |
| `item/permissions/requestApproval`                                                    | `kind: permission`；展示请求的网络 / 文件系统权限                                                                                         | `{ "permissions": <授予的子集>, "scope": "turn" \| "session" }`           |
| `item/tool/requestUserInput`                                                          | M1–M4 不支持自由文本回答：直接回复取消，并发 `notice` 说明                                                                                | 以生成类型里的取消形状为准                                                |
| `mcpServer/elicitation/request`                                                       | 不支持：回复 `{ "action": "decline", "content": null }`，并发 `notice`                                                                    | —                                                                         |
| `execCommandApproval`、`applyPatchApproval`                                           | 旧版接口，正常不会出现；出现则回复拒绝并记 warning 日志                                                                                   | —                                                                         |
| 其他（`item/tool/call`、`attestation/generate`、`account/chatgptAuthTokens/refresh`） | Hub 没有声明相应能力，回复 JSON-RPC 错误 `-32601`                                                                                         | —                                                                         |

- 请求里的 `availableDecisions`（若有）用来过滤 `ApprovalRequest.decisions`。
- 决定映射见 [adapter-interface.md](adapter-interface.md) §7；Hub 不发 `acceptWithExecpolicyAmendment` / `applyNetworkPolicyAmendment`（会改 Codex 的持久策略）。
- 审批在 Hub 里未决期间，任务处于 `awaiting_approval`；Codex 那边的轮一直挂着，不设超时（由人决定或取消）。

## 10. 取消与强制结束

1. `turn/interrupt`（`{ threadId, turnId }`），成功返回 `{}`，之后等 `turn/completed`（`status: interrupted`）。Codex 会清理该轮未决的服务端请求并发 `serverRequest/resolved`，Hub 把对应审批标为 `cancelled`。
2. 10 秒内没有 `turn/completed`：调用 `thread/unsubscribe`（`{ threadId }`），本地把本轮记为 `cancelled`，丢弃该轮之后到达的事件。**不杀共享进程**，以免影响其他任务。
3. 共享进程整体无响应（`account/read` 5 秒超时）：在没有其他进行中的轮时重启；有的话把这些任务一起标 `interrupted` 后重启。

## 11. `threadSource: "user"` 与 ChatGPT 应用可见性

已知事实（0.164.0 生成的类型）：

- `ThreadStartParams.threadSource?: string | null`，注释是“客户端提供的、用于分析的来源分类”。
- `Thread` 上另有 `source: SessionSource`（`cli` / `vscode` / `exec` / `appServer` / …）。app-server 创建的 thread 来源是 `appServer`；`thread/list` 不传 `sourceKinds` 时只返回 `cli` 和 `vscode`，所以默认列表里看不到这些 thread。

owner 给的信息是：传 `threadSource: "user"` 后，会话也会出现在 ChatGPT 应用里。公开文档没写这一点，**按待验证处理**：

- 任务卡 AH-104 做实测：传与不传 `threadSource` 各建一个 thread，看 ChatGPT 应用的 Codex 列表里是否出现、能否继续对话，结论写进 §13。
- 实测通过的 Codex 版本，`capabilities.supportsUserVisibleSessions` 才为 `true`，新建任务对话框里显示“在 ChatGPT 中可见”开关（默认开，待决问题 Q5）。
- 不可见也不影响 Hub 本身：Hub 的任务列表不依赖 Codex 的 thread 列表。Hub 可以用 `thread/list`（`sourceKinds: ["appServer"]`）把自己创建过的 thread 导入历史，作为可选功能。

## 12. 禁止调用的方法

`CodexAdapter` 维护一个**发出方法白名单**：`initialize`、`initialized`、`account/read`、`model/list`、`thread/start`、`thread/resume`、`thread/unsubscribe`、`thread/list`、`thread/read`、`turn/start`、`turn/interrupt`。白名单之外的方法一律在发送前抛错，单测覆盖。特别是：

- `thread/shellCommand`、`command/exec*`、`process/*`：在 Codex 沙箱**之外**执行命令；
- `account/login/*`、`account/logout`：Hub 不接管登录；
- `thread/archive`、`thread/delete` 等：不改用户在 Codex 里的数据。

手工验收（owner 的 Mac 上）：只读任务读仓库并回答问题；只读任务被要求改文件时出现审批或被沙箱拒绝；可写任务在 worktree 里改文件、`git status` 只在 worktree 里有变化；审批的四种决定各走一遍；停止本轮；杀掉 `codex app-server` 进程后任务显示“已中断”并能恢复；§11 的可见性实测。

## 13. 协议兼容表

| Codex 版本 | 核对日期   | 结论                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.164.0    | 2026-10-27 | 生成类型核对：`sandbox` 为 kebab-case（`read-only` / `workspace-write`），`approvalPolicy` 为 `untrusted` / `on-request` / `never` 或 `granular`，`sandboxPolicy.type` 为 camelCase，`UserInput` 文本项必须带 `text_elements`，`threadSource` 存在。真实收发与 ChatGPT 可见性**尚未实测**（AH-104）。 |
