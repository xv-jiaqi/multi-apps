# 测试策略

> 上级文档：[../README.md](../README.md)。原则：**CI 不依赖真实 Agent、真实 GitHub、真实内网**；错误路径和正常路径同等对待，每条错误路径都有编号、有测试；真实 Agent 只在 owner 的 Mac 上按清单手工验收。

## 1. 原则

1. **用真进程测协议**：适配器测试拉起真正的子进程（假 Agent），走真实的 stdio、信号、进程组，不 mock `child_process`。只有纯逻辑（状态机、脱敏、配置校验）用内存单测。
2. **用真 git 测 git**：worktree、diff、推送守卫都对临时目录里的真仓库和本地裸仓库执行；需要“带主机名的远端”时用绑定 `127.0.0.1` 的 `git daemon`。不访问任何外网。
3. **不靠 sleep 同步**：等待一律用 `waitForEvent(predicate, timeoutMs)` 一类的辅助函数；协议超时（握手 30 秒、取消等待 10 秒等）通过 `AdapterDeps` 注入的配置在测试里调成几百毫秒。
4. **Linux 与 macOS 都要过**：CI 跑 Ubuntu，owner 在 macOS 上跑。不依赖平台专有命令；检查进程是否还在用 `process.kill(-pgid, 0)` 是否抛 `ESRCH`，不解析 `ps` 输出。
5. **测试数据不含真实信息**：域名一律用 `*.example`，token 用明显的假值；从真实 Agent 录制的夹具必须先脱敏（§3.3）。
6. **每修一个 bug 先补一个能复现它的测试。**

## 2. 分层

| 层               | 工具                                              | 位置                                 | 内容                                                                                                                            | CI               |
| ---------------- | ------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 契约单测         | vitest（同 `packages/shared`）                    | `contract/src/**/*.test.ts`          | zod schema 的正反例；事件、DTO 的序列化往返                                                                                     | 是               |
| 侧车单测         | jest + ts-jest（同 `apps/cardhub/api`）           | `server/src/**/*.spec.ts`            | 状态机（按 architecture.md §3.1 的表穷举合法与非法迁移）、调度器、增量合并、脱敏、环境白名单、hook 主机解析、配置校验、错误映射 | 是               |
| 适配器协议测试   | jest + 假 Agent 子进程                            | `server/test/adapters/*.e2e-spec.ts` | 每个适配器跑 §4 矩阵里属于它的行                                                                                                | 是               |
| git 与工作区测试 | jest + 临时仓库 + 本地裸仓库 + `git daemon`       | `server/test/git/*.e2e-spec.ts`      | worktree、diff（未跟踪、二进制、重命名、超大）、不碰用户暂存区、应用到本地分支、推送守卫各层                                    | 是               |
| API 集成测试     | jest + supertest + `ws`                           | `server/test/api/*.e2e-spec.ts`      | 在随机端口启动完整 Nest 应用（临时 `AGENT_HUB_HOME`、临时 SQLite），验证鉴权、Host/Origin、幂等、`wait`、WS 续订与关闭码        | 是               |
| 网页 Agent 测试  | jest + Playwright Chromium + 假 AoneD 站点        | `server/test/web/*.e2e-spec.ts`      | 驱动的提交、观察、取消、登录过期、DOM 漂移、超时；双源 git 流程                                                                 | 是               |
| Hub UI 测试      | vitest + Testing Library（同 `apps/cardhub/web`） | `web/src/**/*.test.tsx`              | 任务列表、任务详情、diff 查看、审批卡片、新建任务页、`BotSlot` 位置上报（模拟 `ResizeObserver`）、tRPC 用假链接                 | 是               |
| Rust 壳单测      | `cargo test`                                      | `desktop/src-tauri/src/**`           | desktop-shell.md §9 列出的纯函数                                                                                                | 否（macOS 本机） |
| 手工验收         | 清单                                              | §6                                   | 真实 Codex / Qoder / AoneD、桌面壳、安全清单、本地郎端到端                                                                      | 否               |

## 3. 假 Agent 与夹具

### 3.1 文件

```text
server/test/
├── fakes/
│   ├── fake-codex.mjs        # 说 Codex app-server 线上格式（无 "jsonrpc" 字段）的假进程
│   ├── fake-acp.mjs          # 说 ACP 的假进程，可注入各种故障
│   ├── sdk-agent.mjs         # 用 @agentclientprotocol/sdk 的 AgentSideConnection 写的最小 Agent，做互通性测试
│   ├── fake-aoned/           # 假 AoneD 站点：静态页面 + 小型 HTTP 服务
│   └── scenarios/            # 剧本（JSON）
├── fixtures/                 # 从真实 Agent 录制并脱敏的协议帧（§3.3）
└── helpers/                  # 临时 AGENT_HUB_HOME、临时仓库、git daemon、waitForEvent 等
```

假 Agent 用不需要编译的 `.mjs`，由测试以 `process.execPath` 直接拉起，Linux 与 macOS 行为一致。

### 3.2 剧本

两个假进程都按剧本执行。剧本路径通过环境变量 `FAKE_SCENARIO` 传入（测试会把它加进 profile 的 `envPassthrough`，这本身也验证了环境白名单的放行逻辑）。

```ts
// server/test/fakes/scenario.ts（假进程读取的 JSON 与此一致）
export type FakeStep =
  /** 等待 Hub 发来的请求或通知；不匹配时假进程以退出码 99 退出，并在 stderr 打印差异。 */
  | {
      expect: string;
      match?: Record<string, unknown>;
      reply?: unknown;
      error?: { code: number; message: string };
    }
  /** 主动发通知（Codex 的 item/*、ACP 的 session/update 等）。 */
  | { notify: string; params: unknown }
  /** 主动向 Hub 发请求（审批、fs/read_text_file 等），并断言 Hub 的回复。 */
  | { request: string; params: unknown; expectResult?: Record<string, unknown> }
  | { sleepMs: number }
  /** 原样写一行到 stdout，用来注入非 JSON、截断的 JSON、未知 id 的响应。 */
  | { writeRaw: string }
  | { stderr: string }
  /** 在工作目录里写文件，用来模拟只读任务越界。 */
  | { writeFile: string; content: string }
  | { exit: number }
  /** 停止一切输出，但不退出。 */
  | { hang: true };

export interface FakeScenario {
  name: string;
  protocol: 'codex' | 'acp';
  /** 收到 stdin EOF 后是否退出；false 用于复现 Qoder 的行为。 */
  exitOnStdinClose: boolean;
  /** 忽略 SIGTERM，用来测试 SIGKILL 兜底。 */
  ignoreSigterm?: boolean;
  /** 启动时派生一个常驻子进程，用来测试按进程组结束。 */
  spawnGrandchild?: boolean;
  /** 在第一个响应里附带自己收到的环境变量名（只有名字），用来测试环境白名单。 */
  echoEnvNames?: boolean;
  steps: FakeStep[];
}
```

剧本里的 id（`threadId`、`sessionId`、审批请求 id）写成固定值，断言更直接。

`sdk-agent.mjs` 只走正常路径，作用是证明 `AcpAdapter` 和官方 SDK 实现的 Agent 能互通，防止假进程和真实协议慢慢走偏。

### 3.3 录制夹具

- 来源：owner 在 Mac 上用真实 Agent 跑任务后，`transcripts/<taskId>.ndjson`（已经过 `redact`）。
- 导入：`pnpm --filter @agent-hub/server run fixtures:import <transcript> --agent codex --name <场景名>`，再脱敏一遍，转成剧本，存到 `server/test/fixtures/<agent>/<agent 版本>/<场景名>.json`。
- 导入后人工检查一遍：没有真实路径中的用户名（替换为 `/Users/dev`）、没有内网域名、没有提示词里的公司代码。
- CI 里有一个测试扫描整个 `fixtures/` 目录，对 security.md §5 的每一种密钥模式断言零命中。
- 协议兼容表（adapter-codex.md §13、adapter-acp.md §8）里每个“已实测”的版本都要有对应的夹具，回放测试必须通过。

### 3.4 假 AoneD

- 一个绑定 `127.0.0.1` 随机端口的 HTTP 服务，页面结构按驱动配置文件里的选择器写。
- 页面：登录页（没有会话 Cookie 时跳转过去）、新建任务页、会话页（日志随时间追加、有“停止”按钮、结束时显示状态）。
- 后端在“任务完成”时向测试用的内网裸仓库的任务分支推一个提交，模拟云端 Agent 的产出。内网远端由 `git daemon --listen=127.0.0.1` 提供，测试配置把 `127.0.0.1` 加入 `security.allowedPushHosts`，并把 `security.allowedPushProtocols` 设为 `["git"]`（默认是 `ssh`、`https`）。
- 查询参数切换故障：`?drift=1`（改掉关键选择器）、`?never=1`（永不结束）、`?expire=<秒>`（会话中途过期）、`?crash=1`（让页面进程崩溃，用 CDP 的 `Page.crash`）。

### 3.5 测试环境

- 每个测试文件一个临时 `AGENT_HUB_HOME`（权限 `700`），结束时删除。
- SQLite：jest `globalSetup` 里对一个模板库执行一次 `prisma migrate deploy`，每个测试文件复制一份，省去重复迁移的时间。
- 测试中的侧车绑定随机端口，不能占用 47821（owner 本机上可能有正在运行的 Hub）。

## 4. 错误路径矩阵

每一行都要有测试，测试名以编号开头，例如 `it('[E23] stdin 关闭后不退出的 Agent 被按进程组结束', …)`。AH-002 加一个检查脚本：解析本表的编号，确认每个编号至少出现在一个测试名里，接进 `pnpm test`。

“层”一列：U = 侧车单测，A = 适配器协议测试，G = git 测试，I = API 集成测试，W = 网页 Agent 测试，M = 手工验收。

### 4.1 进程与握手

| 编号 | 场景             | 层  | 注入方式                                                               | 期望                                                                                                               |
| ---- | ---------------- | --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| E01  | 可执行文件不存在 | A   | profile 的 `command` 指向不存在的路径                                  | 健康状态 `unavailable`（`AGENT_BINARY_NOT_FOUND`）；创建任务返回 `409 AGENT_UNAVAILABLE`                           |
| E02  | 启动后立即退出   | A   | 剧本第一步 `exit: 1`，之前写 stderr                                    | `AGENT_SPAWN_FAILED`，`detail` 里有 stderr 末尾若干行；任务 `failed`                                               |
| E03  | 握手无响应       | A   | 剧本 `hang`                                                            | 超时后 `AGENT_HANDSHAKE_TIMEOUT`，进程组被结束，没有残留进程                                                       |
| E04  | 协议版本不支持   | A   | ACP `initialize` 返回不支持的 `protocolVersion`                        | `AGENT_PROTOCOL_UNSUPPORTED`，健康状态 `unavailable`                                                               |
| E05  | 未登录           | A   | Codex `account/read` 返回 `account: null`；ACP 要求鉴权                | 健康状态 `auth_required`；创建任务返回 `409 AGENT_AUTH_REQUIRED`；Hub 没有调用任何登录方法                         |
| E06  | 子进程环境       | A   | 侧车环境里放 `FAKE_SECRET_TOKEN`、`SSH_AUTH_SOCK`，剧本 `echoEnvNames` | 回显的变量名里没有这两个；有 `GIT_ALLOW_PROTOCOL`、`GIT_TERMINAL_PROMPT`；`FAKE_SCENARIO` 按 `envPassthrough` 放行 |

### 4.2 协议

| 编号 | 场景                                 | 层  | 注入方式                                      | 期望                                                                                  |
| ---- | ------------------------------------ | --- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| E07  | stdout 出现非 JSON 行                | A   | `writeRaw: "hello"`                           | 跳过该行、记 warning 日志，后续帧照常处理（ACP 以 SDK 的行为为准，测试把它固定下来）  |
| E08  | 截断的 JSON / 超过单行上限           | A   | `writeRaw` 写半个对象；Codex 写超过上限的一行 | 前者同 E07；后者 `AGENT_PROTOCOL_ERROR`，Codex 共享进程重启，涉及的任务 `interrupted` |
| E09  | 未知 id 的响应                       | A   | `writeRaw` 一个不存在的 `id`                  | 丢弃并记 warning，不影响其他请求                                                      |
| E10  | 普通请求超时                         | A   | `model/list` 不回复                           | 请求超时 → 模型列表为空并提示，不影响已在运行的任务                                   |
| E11  | 未知通知、未知 `session/update` 变体 | A   | `notify` 一个新方法 / 新变体                  | 忽略，每种只记一次 debug 日志                                                         |
| E12  | stderr 大量输出                      | A   | 循环写 10 MB stderr                           | 不阻塞 stdout 的处理；日志只保留末尾部分                                              |
| E13  | stdin 写入背压                       | A   | 剧本长时间不读 stdin，Hub 连续发送大提示词    | 等 `drain` 后继续，不丢数据、不抛异常                                                 |

### 4.3 轮与审批

| 编号 | 场景                             | 层  | 注入方式                   | 期望                                                                                                         |
| ---- | -------------------------------- | --- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| E14  | 正常一轮                         | A   | 消息增量 + 工具调用 + 结束 | 状态 `queued → preparing → running → completed`；事件 `seq` 连续；增量按 200 ms / 16 KB 合并落库             |
| E15  | 一次审批，批准                   | A   | 中途 `request` 审批        | `awaiting_approval`；`allow_once` 映射为协议值（Codex `accept`、ACP 选 `allow_once` 选项）；回到 `running`   |
| E16  | 拒绝                             | A   | 同上，决定 `reject`        | 协议值正确（Codex `decline`、ACP `reject_once`）；工具调用 `declined`；本轮继续                              |
| E17  | 同时多个审批                     | A   | 连发两个审批请求           | 两个都决定后才回到 `running`                                                                                 |
| E18  | ACP 没有 `reject_once` 选项      | A   | 审批选项只有 allow         | `decisions` 只有允许类和 `cancel_turn`                                                                       |
| E19  | 桥接 token 审批                  | I   | 默认 token 调审批接口      | `403 FORBIDDEN_SCOPE`；审批仍为待决                                                                          |
| E20  | 重复决定                         | I   | 同一审批决定两次           | 第二次 `409 APPROVAL_ALREADY_RESOLVED`                                                                       |
| E21  | 用量上限 / 上下文超长 / 上游错误 | A   | 剧本返回对应错误           | `AGENT_USAGE_LIMIT` / `AGENT_CONTEXT_EXCEEDED` / `AGENT_UPSTREAM_ERROR`；`prompt()` 不 reject；任务 `failed` |
| E22  | 不支持的模型                     | I   | 创建任务时指定列表外的模型 | `400 MODEL_NOT_SUPPORTED`，不创建任务                                                                        |

### 4.4 取消与进程结束

| 编号 | 场景                             | 层  | 注入方式                         | 期望                                                                                                                          |
| ---- | -------------------------------- | --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| E23  | stdin 关闭后不退出（Qoder 行为） | A   | `exitOnStdinClose: false`        | `dispose` 后进程组被 SIGTERM 结束；`process.kill(-pgid, 0)` 抛 `ESRCH`                                                        |
| E24  | 忽略 SIGTERM                     | A   | `ignoreSigterm: true`            | 等待期满后 SIGKILL；没有残留进程                                                                                              |
| E25  | Agent 派生的子进程               | A   | `spawnGrandchild: true`          | 孙子进程随进程组一起结束                                                                                                      |
| E26  | 停止本轮，Agent 正常响应         | A   | 收到取消后剧本返回 `cancelled`   | 未决审批按协议回复“已取消”（ACP 必须是 `outcome: cancelled`），审批记 `cancelled` 并发 `approval.withdrawn`；任务 `cancelled` |
| E27  | 停止本轮，Agent 不响应           | A   | 收到取消后 `hang`                | ACP：等待期满后结束进程组；Codex：只记本轮 `cancelled`、丢弃该 turn 后续事件，共享进程不被杀                                  |
| E28  | 排队中、准备中取消               | U   | 槽位占满时创建并取消             | 直接 `cancelled`；准备中已建的 worktree 保留                                                                                  |
| E29  | Codex 共享进程崩溃               | A   | 两个任务运行中，剧本 `exit: 137` | 两个任务都 `interrupted`（`AGENT_CRASHED`）；按 1 s / 5 s / 30 s 退避重启；用 `thread/resume` 恢复成功                        |

### 4.5 恢复

| 编号 | 场景                            | 层  | 注入方式                                                                                  | 期望                                                                                          |
| ---- | ------------------------------- | --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| E30  | 侧车被强杀时有任务在等审批      | I   | 以子进程方式启动侧车，任务进入 `awaiting_approval` 后对侧车发 SIGKILL，再启动一次         | 任务 `interrupted`；未决审批 `expired`；残留的假 Agent 进程组被清理；点“恢复”后新建一轮“继续” |
| E31  | 原生会话无法恢复                | A   | ACP 不声明 `resume` / `load`                                                              | 追问返回 `409 TASK_NOT_RESUMABLE`                                                             |
| E32  | 追问进行中的任务                | I   | `running` 时追问                                                                          | `409 TASK_BUSY`                                                                               |
| E33  | 数据库迁移失败                  | I   | 临时库被写坏                                                                              | 侧车启动失败，退出码非零，错误信息里有备份位置                                                |
| E68  | 壳进程消失（侧车 stdin 被关闭） | I   | 以子进程方式启动侧车入口，写入 UI token 行、等到 ready，运行一个假 Agent 任务后关闭 stdin | 侧车在 10 秒内退出；假 Agent 进程组已不存在；下次启动时该任务为 `interrupted`                 |

### 4.6 工作区与 git

| 编号 | 场景                                | 层  | 注入方式                                                       | 期望                                                                                          |
| ---- | ----------------------------------- | --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| E34  | 注册的路径不存在或不是 git 仓库     | I   | 注册临时空目录                                                 | `400 VALIDATION_FAILED`，说明原因                                                             |
| E35  | `worktreeSetup` 失败或超时          | G   | 配成 `["false"]` / 一个长时间 sleep 的命令                     | `WORKSPACE_SETUP_FAILED`，任务 `failed`，worktree 保留                                        |
| E36  | `in_place` 写任务互斥               | U   | 同一目录先后创建写任务和只读任务                               | 后者排队，前者结束后才开始                                                                    |
| E37  | 只读任务改了工作区                  | A   | ACP 剧本 `writeFile`                                           | `notice`（warning）+ `readOnlyViolation`；不回滚                                              |
| E38  | diff 的各种情况                     | G   | 未跟踪文件、二进制、重命名、超过 5 MB 的补丁                   | 统计正确；二进制不内联；超限 `truncated`；**前后对比用户的 `git diff --cached` 输出完全一致** |
| E39  | ACP 写文件越界                      | A   | `request: fs/write_text_file`，路径在 worktree 外或 `.git/` 内 | 向 Agent 返回错误；文件未被写；写审计                                                         |
| E40  | 应用到本地分支：原仓库脏 / 合并冲突 | G   | 原仓库有未提交改动；制造冲突                                   | 前者拒绝并提示；后者 `git merge --abort`，原仓库恢复原状                                      |

### 4.7 推送守卫与其他安全控制

| 编号 | 场景                                | 层   | 注入方式                                                                                                          | 期望                                                                               |
| ---- | ----------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| E41  | Agent 环境里推送 `origin`           | G    | 用 security.md §3.1 的环境执行 `git push origin`（`origin` 指向 `git://127.0.0.1` 的 daemon，并带显式 `pushurl`） | 失败（`transport 'git' not allowed`）；裸仓库没有新引用                            |
| E42  | Agent 环境里用 `insteadOf` 改写     | G    | 全局配置里加改写规则把远端改到 daemon                                                                             | 同 E41                                                                             |
| E43  | `pre-push` 主机检查                 | G    | 去掉 `GIT_ALLOW_PROTOCOL`，只保留 hooks 目录，推到不在白名单的 `127.0.0.1`                                        | 被 hook 拒绝；放进白名单后成功；仓库原来的 `pre-push` 被转发调用                   |
| E44  | Hub 推送到被改写成 GitHub 的远端    | G    | `internal` 的 URL 经 `insteadOf` 改写为 `https://github.com/...`                                                  | 推送前被拒（`GIT_PUSH_BLOCKED`），没有发起任何网络连接；审计里的 URL 不含 userinfo |
| E45  | Hub 推送非 `agent-hub/*` 分支或强推 | G    | 直接调用推送服务                                                                                                  | 拒绝                                                                               |
| E46  | 远端跟踪分支变化检测                | G    | 轮中用不带守卫的环境推一次命名远端                                                                                | 轮结束后有 `security.alert` 审计和 warning 事件                                    |
| E47  | 脱敏                                | U、A | 剧本消息里带 security.md §5 的每种密钥                                                                            | 日志、transcript、桥接 API 返回里都是 `«已脱敏»`；Hub UI 的 tRPC 返回原文          |
| E48  | `cwd` 越界                          | I    | 创建任务时 `cwd` 指向注册仓库之外                                                                                 | `400 PATH_NOT_ALLOWED`                                                             |

### 4.8 本地 API

| 编号 | 场景                  | 层  | 注入方式                                                  | 期望                                                                       |
| ---- | --------------------- | --- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| E49  | Host / Origin / token | I   | 非法 `Host`；非法 `Origin`；无 token；吊销的 token        | `421 HOST_NOT_ALLOWED`；`403 ORIGIN_NOT_ALLOWED`；`401`；WS 以 `4401` 关闭 |
| E50  | 幂等键                | I   | 同一键同一请求体发两次；同一键不同请求体                  | 返回同一个任务；`409 IDEMPOTENCY_CONFLICT`                                 |
| E51  | 长轮询                | I   | `wait` 超时；`wait` 期间本轮结束                          | `reached: false` 带新事件；`reached: true` 立即返回                        |
| E52  | WS 续订               | I   | 收到一半断开，用最后的 `seq` 重连；回放期间持续产生新事件 | 不重不漏，`seq` 严格递增                                                   |
| E53  | 慢消费者              | I   | 客户端不读，服务端缓冲超过阈值（测试里调小）              | 以 `4008` 关闭；重连续订后数据完整                                         |
| E54  | 排队已满、桥接暂停    | I   | 调小 `maxQueued`；打开暂停开关                            | `503 QUEUE_FULL`；`503 BRIDGE_PAUSED`                                      |
| E55  | 桥接方写任务待确认    | I   | 桥接 token 创建写任务                                     | `pending_confirmation`；界面确认后 `queued`；拒绝后 `cancelled`；都写审计  |

### 4.9 网页 Agent

| 编号 | 场景             | 层  | 注入方式                 | 期望                                                               |
| ---- | ---------------- | --- | ------------------------ | ------------------------------------------------------------------ |
| E56  | 正常流程         | W   | 假 AoneD 正常完成        | 任务分支推到测试内网裸仓库；结束后 fetch 到远端提交；diff 正确     |
| E57  | 提交前需要登录   | W   | 没有会话 Cookie          | `auth_required`；登录等待期满（测试里调小）后 `WEB_LOGIN_REQUIRED` |
| E58  | 观察中途登录过期 | W   | `?expire=2`              | `error`（`WEB_LOGIN_REQUIRED`）；重新登录后用远端会话链接继续观察  |
| E59  | 页面结构变化     | W   | `?drift=1`               | `WEB_DOM_DRIFT`，附截图路径                                        |
| E60  | 远端超时         | W   | `?never=1`，调小最长时间 | 尝试停止，任务 `failed`（`WEB_TIMEOUT`）                           |
| E61  | 浏览器崩溃       | W   | `?crash=1`               | 重启并恢复观察；连续 3 次后 `AGENT_CRASHED`                        |
| E62  | 任务分支已存在   | W   | 预先在裸仓库建同名分支   | 换短号重试一次成功                                                 |

### 4.10 桌面壳

| 编号 | 场景                        | 层  | 期望                                                             |
| ---- | --------------------------- | --- | ---------------------------------------------------------------- |
| E63  | 找不到 Node 22              | M   | 错误页说明如何安装，不白屏                                       |
| E64  | 端口被占用 / 已有实例在运行 | M   | 已有实例：聚焦已有窗口；端口被其他程序占用：错误页               |
| E65  | 侧车崩溃                    | M   | 按退避重启，Hub UI 自动重连；5 分钟内失败 5 次后停止并显示“重试” |
| E66  | 本地郎页面打不开            | M   | Bot 面板显示 WebView 自己的错误页，Hub UI 正常可用               |
| E67  | Bot 页面调用 IPC            | M   | 失败                                                             |

## 5. CI

AH-001 要在 `.github/workflows/ci.yml` 里做的改动：

- 在 “Generate Prisma client” 后面加一步：`pnpm --filter @agent-hub/server --fail-if-no-match exec pnpm run db:generate`（与 `@cardhub/api` 的写法一致）。SQLite 不需要服务容器。
- `@agent-hub/server` 依赖的 `playwright` 版本与 `@cardhub/web` 保持一致，这样 CI 现有的 “Install Playwright Chromium” 一步装的浏览器可以复用；版本不同就要加一步单独安装。
- Agent Hub 的测试不读 `turbo.json` 里 `test.env` 列出的任何变量，需要的配置都写在 jest 配置和测试辅助代码里。
- Ubuntu 镜像自带 git，`git daemon` 是 git 的一部分。
- `desktop/` 不进 CI（与 `@cardhub/native` 一样），它的 `lint` / `typecheck` 脚本只对前端 TS 生效。

## 6. 手工验收（owner 的 Mac）

每个里程碑结束时按下表执行，把结果（含 Agent 版本、macOS 版本）贴进 PR：

| 项目         | 内容                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 桌面壳       | [desktop-shell.md](desktop-shell.md) §10 全部                                                                                                    |
| 安全         | [security.md](security.md) §10 全部                                                                                                              |
| Codex        | 健康为 `ready`；模型列表与 ChatGPT 应用里的一致；只读任务出结果；一次审批（批准与拒绝各一次）；停止本轮；侧车重启后恢复；AH-104 的会话可见性实测 |
| Qoder        | 同 Codex 的前五项；任务结束、闲置超时后 `qodercli` 进程不再存在（活动监视器里查看）；切换模型与模式生效                                          |
| AoneD        | 登录；提交；观察到输出；任务分支出现在内网；结束后 fetch 到提交、diff 正确；GitHub 上没有出现任何新分支                                          |
| 本地郎端到端 | 本地郎经 API 派任务 → `wait` → 取结果与 diff；同时在 Hub 里看到该任务的实时输出；审批只能在 Hub 里做                                             |
| 录制夹具     | 新验收过的 Agent 版本，按 §3.3 录制至少“正常一轮”和“一次审批”两个夹具                                                                            |
