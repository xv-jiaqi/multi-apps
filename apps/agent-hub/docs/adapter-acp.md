# 通用 ACP 适配器（Qoder / Claude Code / Gemini CLI …）

> 上级文档：[adapter-interface.md](adapter-interface.md)。ACP（Agent Client Protocol）是编辑器与编程 Agent 之间的开放协议：JSON-RPC 2.0，默认走 stdio。Hub 扮演 ACP 的 **Client**，各 Agent 是 **Agent**。
>
> 本文的 SDK 用法对照 **`@agentclientprotocol/sdk` 2.0.2** 的类型核对过（2026-10-27），§2 的示例代码能通过 `tsc --strict` 编译。

## 1. 为什么“通用适配器 + profile”

- Qoder（`qodercli --acp`）、Claude Code（经 ACP 适配器）、Gemini CLI 都说 ACP。一个 `AcpAdapter` 实现协议，Agent 之间的差异（启动命令、选模型的方式、进程退出行为、登录提示）收进 **profile**（§6）。
- 接一个新的 ACP Agent 通常只需在 `config.json` 加一项；有怪癖再加一个 profile，不复制适配器。

## 2. SDK 与传输

- 用 SDK 的**默认入口** `@agentclientprotocol/sdk`（稳定的 ACP v1）。不用 `/experimental/v2`：v2 的线上协议还会不兼容地变化。版本锁在 `2.0.x`，升级要重跑 §8 的兼容核对。
- 核对过的 SDK 行为（实现时注意）：
  1. **`session/new` 的响应原样透传**：v1 入口不对这个响应做 schema 解析，Agent 返回的非标准字段（例如旧版的 `models`）能读到。（v2 入口会解析并剥离未知字段。）
  2. **发出的请求参数会按 schema 解析，未知字段被剥离**：要给 Agent 传非标准参数，只能放进 `_meta`，或用自定义方法重载 `request<Response, Params>(method, params)`。
  3. **SDK 2.x 的类型里已经没有 `session/set_model`**：标准做法改成了 `session/set_config_option`（`category: "model"`）。Qoder 仍用 `session/set_model`，只能走自定义方法重载（示例见下）。
  4. 处理函数收到的是上下文对象 `{ method, params, signal, agent, requestId }`，不是参数本身。
- 每个任务一个进程（`processModel: perTask`，独立进程组）。stdin / stdout 转成 Web Streams 交给 `ndJsonStream`；在两者之间插一层逐行旁路，把原始帧交给 `sink.rawFrame()`（写 transcript、录测试夹具）。

```ts
import { Readable, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import * as acp from '@agentclientprotocol/sdk';

declare const proc: ChildProcessWithoutNullStreams; // 实际由 ProcessSupervisor 启动
declare const mode: 'read_only' | 'write';
declare const cwd: string;
declare const version: string;
declare const modelId: string;
declare const text: string;

export async function demo() {
  const stream = acp.ndJsonStream(
    Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
  );

  const conn = acp
    .client({ name: 'agent-hub' })
    .onNotification(acp.methods.client.session.update, async ({ params }) => {
      void params.update.sessionUpdate; // 交给 UpdateRouter，见 §5
    })
    .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
      const option = params.options.find((o) => o.kind === 'allow_once');
      return option
        ? { outcome: { outcome: 'selected' as const, optionId: option.optionId } }
        : { outcome: { outcome: 'cancelled' as const } };
    })
    .onRequest(acp.methods.client.fs.readTextFile, async ({ params }) => ({ content: params.path }))
    .onRequest(acp.methods.client.fs.writeTextFile, async () => ({}))
    .connect(stream);

  const init = await conn.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: mode === 'write' },
      terminal: false,
    },
    clientInfo: { name: 'agent-hub', title: 'Agent Hub', version },
  });
  void init.agentCapabilities?.loadSession;

  const session = await conn.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
  // Qoder：SDK 没有 session/set_model 的类型，用自定义方法重载
  await conn.agent.request<unknown, { sessionId: string; modelId: string }>('session/set_model', {
    sessionId: session.sessionId,
    modelId,
  });
  const result = await conn.agent.request(acp.methods.agent.session.prompt, {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text }],
  });
  const stop: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' =
    result.stopReason;
  await conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
  conn.close();
  return stop;
}
```

上面只演示 API 形状：真实实现里权限处理函数要把请求挂起、等人决定（§4），读写文件要过 §3.3 的把关。

## 3. 握手、鉴权与客户端能力

### 3.1 `initialize`

| 字段                                  | 取值                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| `protocolVersion`                     | `acp.PROTOCOL_VERSION`（当前为 `1`）                 |
| `clientInfo`                          | `{ name: "agent-hub", title: "Agent Hub", version }` |
| `clientCapabilities.fs.readTextFile`  | `true`                                               |
| `clientCapabilities.fs.writeTextFile` | 只读任务 `false`，可写任务 `true`                    |
| `clientCapabilities.terminal`         | `false`（M3 不实现终端；Agent 用自己的工具执行命令） |

- 响应的 `protocolVersion` 不是 `1` → `AGENT_PROTOCOL_UNSUPPORTED`。
- 记下 `agentCapabilities`：`loadSession`、`sessionCapabilities.resume`、`sessionCapabilities.close`、`promptCapabilities.image`。它们决定 `supportsResume`、`supportsImages` 和 §7 的结束方式。
- 握手超时 30 秒。

### 3.2 鉴权

- **Hub 不调用 `authenticate`**（可能拉起浏览器登录流程，等于接管登录）。
- `session/new` 返回需要登录的错误（`authMethods` 非空且错误码为 `-32000`）时，健康状态记 `auth_required`，提示文案用 profile 的 `authHint`（例如“在终端运行 `qodercli` 完成登录”）。

### 3.3 客户端文件方法的把关

Hub 声明了 `fs` 能力，Agent 可能经 Hub 读写文件。这是 Hub 对 ACP Agent 为数不多的硬控制点：

| 方法                 | 规则                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs/read_text_file`  | 路径必须是绝对路径；`realpath` 之后必须位于任务工作区或已注册仓库之内；单文件上限 10 MB。否则返回 JSON-RPC 错误。                                                   |
| `fs/write_text_file` | 只读任务一律拒绝；可写任务的路径 `realpath`（文件不存在时取父目录）后必须位于 `writableRoots` 之内，且不能写 `.git/` 目录。写入前后的内容产出一条 `diff.reported`。 |
| `terminal/*`         | 未声明能力，返回 `-32601`。                                                                                                                                         |

注意：Agent 也可以绕开客户端方法，用自己的工具直接改文件或执行命令。ACP 没有 Hub 能强制的沙箱，所以只读任务还要靠工作区快照比对（architecture.md §6.3）和 profile 里的只读模式（§6）。

## 4. 会话

### 4.1 新建

1. `session/new`（`{ cwd, mcpServers: [] }`）→ `sessionId`，以及可选的 `modes`、`configOptions`（和非标准的 `models`，由 profile 的 `parseExtraModels` 解析）。
2. 按用户选择设置模型、推理档位、模式，顺序如下，失败只发 `notice` 不中断任务：

   | 设置项   | 优先用                                                     | 退路                                                                                       |
   | -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
   | 模型     | `session/set_config_option`（`category: "model"` 的选项）  | profile `modelSelection: "set_model"` 时发 `session/set_model`（`{ sessionId, modelId }`） |
   | 推理档位 | `session/set_config_option`（`category: "thought_level"`） | 不支持则忽略，界面不显示推理档选择                                                         |
   | 模式     | `session/set_config_option`（`category: "mode"`）          | `session/set_mode`（`{ sessionId, modeId }`）                                              |

3. 只读任务：profile 有 `readOnlyModeId` 时切到该模式；`forbiddenModeIds`（如 Claude Code 的 `bypassPermissions`）任何情况下都不切，用户也选不到。
4. 产出 `session.started`。

### 4.2 恢复

依次尝试：

1. `sessionCapabilities.resume` 存在 → `session/resume`（`{ sessionId, cwd, mcpServers: [] }`）；
2. `agentCapabilities.loadSession` 为真 → `session/load`（同样参数）。`session/load` 会把历史以 `session/update` 重放一遍，**重放期间收到的更新全部丢弃**（Hub 自己有历史），等 `session/load` 的响应回来再恢复正常路由；
3. 都不支持 → `SESSION_NOT_RESUMABLE`。界面提供“在新会话中继续”：新建会话，把上一轮的最终回复和 diff 摘要拼进提示词。

## 5. 轮与事件映射

- `session/prompt`（`{ sessionId, prompt: ContentBlock[] }`）：文本用 `{ type: "text", text }`；附件文件用 `{ type: "resource_link", uri: "file://<绝对路径>", name }`；图片仅在 `promptCapabilities.image` 为真时附带。
- 响应的 `stopReason`（`end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled`）与 Hub 的 `StopReason` 同名，直接映射。请求本身失败（JSON-RPC 错误）→ `error`。
- 轮进行中的 `session/update`：

| `sessionUpdate`                                                                      | 产出的 `AgentEvent`                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_message_chunk`                                                                | `message.delta`。连续的消息块共用一个 `itemId`；中间插入工具调用后开新的 `itemId`                                                                                                                                                                                       |
| `agent_thought_chunk`                                                                | `reasoning.delta`                                                                                                                                                                                                                                                       |
| `user_message_chunk`                                                                 | 不产出（是对用户输入的回显）                                                                                                                                                                                                                                            |
| `tool_call`                                                                          | `tool.started`：`toolKind` 由 ACP `kind` 映射（`execute` → `command`，`read` / `edit` / `delete` / `move` / `search` / `fetch` / `think` 同名，`switch_mode` / `other` → `other`）；`paths` 取 `locations[].path`；`execute` 时 `command` 取 `rawInput.command`（若有） |
| `tool_call_update`：`content` 为文本                                                 | `tool.output`（`stream: text`）                                                                                                                                                                                                                                         |
| `tool_call_update`：`content` 为 `diff`                                              | `diff.reported`（由 `oldText` / `newText` 生成该文件的统一 diff）                                                                                                                                                                                                       |
| `tool_call_update`：`status` 为 `completed` / `failed`                               | `tool.completed`                                                                                                                                                                                                                                                        |
| `plan`                                                                               | `plan.updated`（`entries[].content` → `step`）                                                                                                                                                                                                                          |
| `current_mode_update`                                                                | `config.updated`（`agentMode`）                                                                                                                                                                                                                                         |
| `config_option_update`                                                               | `config.updated`（模型 / 推理档位）                                                                                                                                                                                                                                     |
| `usage_update`                                                                       | `usage.updated`                                                                                                                                                                                                                                                         |
| `notice`                                                                             | `notice`                                                                                                                                                                                                                                                                |
| `compaction_update`                                                                  | `notice`（info：“Agent 压缩了上下文”）                                                                                                                                                                                                                                  |
| `available_commands_update`、`session_info_update`、`compaction_summary_chunk`、其他 | 只写 transcript                                                                                                                                                                                                                                                         |

- 轮结束时补发尚未结束的 `message.completed` / `reasoning.completed`（文本为该 item 的增量拼接）。
- 被拒绝的工具调用以 `status: failed` 结束时，如果对应审批是 `reject`，`tool.completed` 记 `declined`。

### 5.1 权限请求

`session/request_permission`（`{ sessionId, toolCall, options[] }`）：

1. 生成 `ApprovalRequest`：`kind` 按 `toolCall.kind` 归类（adapter-interface.md §7），标题取 `toolCall.title`，`paths` 取 `toolCall.locations`，`command` 取 `toolCall.rawInput.command`（若有）；`decisions` 按 `options[].kind` 推出。
2. 处理函数返回一个 Promise，挂起直到人做决定，再按 adapter-interface.md §7 的表回复 `{ outcome: { outcome: "selected", optionId } }`。
3. 本轮被取消时，所有挂起的权限请求**必须**回复 `{ outcome: { outcome: "cancelled" } }`（ACP 规范要求），对应审批标 `cancelled`。

## 6. Profile

```ts
// server/src/adapters/acp/profiles/types.ts
import type { ModelOption } from '@agent-hub/contract';

export interface AcpProfile {
  id: string;
  displayName: string;
  defaultCommand: string;
  defaultArgs: string[];
  /** 选模型的方式：标准 config option、Qoder 的 session/set_model、或不支持。 */
  modelSelection: 'config_option' | 'set_model' | 'none';
  /** 只读任务要切换到的会话模式（Agent 有“只问不改”模式时）。 */
  readOnlyModeId?: string;
  /** 任何情况下都不允许切换到的模式。 */
  forbiddenModeIds: string[];
  /** 关闭 stdin 后进程会不会自己退出；Qoder 为 false。 */
  exitsOnStdinClose: boolean;
  processModel: 'perTask' | 'shared';
  /** 在清洗后的环境之外，还需要从父进程继承的变量名（例如 Agent 自己的配置目录变量）。 */
  envPassthrough: string[];
  /** 未登录时给用户的提示。 */
  authHint: string;
  /** 解析 session/new 响应里的非标准模型字段。 */
  parseExtraModels?(rawNewSessionResult: unknown): ModelOption[] | undefined;
}
```

| profile       | 启动命令（默认）                                                                                            | 选模型          | 只读模式              | 禁用模式            | stdin 关闭后退出 | 登录提示                        | 状态    |
| ------------- | ----------------------------------------------------------------------------------------------------------- | --------------- | --------------------- | ------------------- | ---------------- | ------------------------------- | ------- |
| `qoder`       | `qodercli --acp`                                                                                            | `set_model`     | 待探测（M3 实测后填） | 待探测              | **否**           | 在终端运行 `qodercli` 完成登录  | M3 实现 |
| `claude-code` | Claude Code 的 ACP 适配器（包名与命令以 ACP 官网 Agents 列表为准，建议全局安装，避免运行时 `npx` 联网下载） | `config_option` | `plan`（待实测）      | `bypassPermissions` | 待实测           | 在终端运行 `claude` 完成登录    | M5 配置 |
| `gemini`      | `gemini` 加 ACP 开关（参数名随版本变化，以 `gemini --help` 为准）                                           | `config_option` | 待实测                | 待实测              | 待实测           | 在终端运行 `gemini` 完成登录    | M5 配置 |
| `generic`     | 用户填写                                                                                                    | `config_option` | 无                    | 无                  | 按“否”处理       | “请先在终端完成该 Agent 的登录” | M3 实现 |

### 6.1 Qoder 要点

- 方法：`initialize`、`session/new`、`session/prompt`、`session/update`、`session/set_model`、`session/set_mode`、`session/request_permission`。
- **关闭 stdin 后进程不退出**：结束时不能只关 stdin，必须按 §7 主动结束进程组。测试里用一个“忽略 EOF”的假 Agent 复现这一行为（testing.md §3）。
- 模型列表可能只在 `session/new` 的响应里（可能是非标准字段），由 `parseExtraModels` 解析；M3 的探测任务卡把实际形状记进 §8。

## 7. 取消与进程结束

**停止本轮**：发 `session/cancel` 通知 → 回复所有挂起的权限请求为 `cancelled` → 等 `session/prompt` 返回 `stopReason: cancelled`，最多 10 秒 → 超时则结束进程组，本轮记 `cancelled`、任务记 `cancelled`。

**结束会话**（`dispose`，任务完成后闲置超时、任务取消、侧车停机时调用）：

1. Agent 声明了 `sessionCapabilities.close` → 发 `session/close`，等 2 秒；
2. 关闭 stdin；
3. `exitsOnStdinClose` 为真时等 2 秒看进程是否自行退出；为假（Qoder）则跳过等待；
4. 对进程组发 SIGTERM，等 3 秒；
5. 仍未退出 → 对进程组发 SIGKILL；
6. 记录 `agent.exited`。

进程组：以 `detached: true` 启动，pgid 等于 pid，对 `-pgid` 发信号，Agent 拉起的子进程（测试、构建、语言服务）一并结束。

**闲置保留**：任务 `completed` 后进程保留 `idleTimeoutMs`（默认 10 分钟），方便马上追问；超时后 `dispose`，之后的追问走 §4.2 恢复。

**能力探测**：初始化时以及用户点“刷新”时，在 `<AGENT_HUB_HOME>/probe/<agentId>`（空目录）里起一个进程：`initialize` → `session/new` → 读取模式、配置项、模型 → 按上面的流程结束。结果缓存 10 分钟。探测失败时模型列表为空、`modelsSource: 'session'`（界面提示“启动后可选模型”）。

## 8. 协议兼容表

| 对象                             | 核对日期   | 结论                                                                                                                                                                                                                        |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agentclientprotocol/sdk` 2.0.2 | 2026-10-27 | 默认入口为 ACP v1；`session/new` 响应透传、请求参数会剥离未知字段；类型中无 `session/set_model`；`sessionCapabilities` 有 `resume` / `close` / `list` / `delete`；`session/update` 有 14 种变体（见 §5）。§2 示例编译通过。 |
| `qodercli --acp`                 | —          | **未实测**（AH-301 填写：版本、模型字段形状、模式列表、是否支持 `session/load` / `resume` / `close`、stdin 行为）。                                                                                                         |
| Claude Code ACP 适配器           | —          | 未实测（M5）。                                                                                                                                                                                                              |
| Gemini CLI                       | —          | 未实测（M5）。                                                                                                                                                                                                              |
