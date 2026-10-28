# 测试策略

> 上级文档：[../README.md](../README.md)。原则：**CI 不依赖真实 Agent、真实 GitHub、真实内网**；错误路径和正常路径同等对待，每条错误路径都有编号、有测试；真实 Agent 只在 owner 的 Mac 上按 §7 手工验收。存储用 `node:sqlite`（D13）。

## 1. 原则

1. **用真进程测协议**：适配器测试拉起真正的子进程（假 Agent），走真实的 stdio、信号、进程组，不 mock `child_process`。只有纯逻辑（状态机、脱敏、配置校验、推送目标）用内存单测。
2. **用真 git 测 git**：worktree、diff、推送守卫都对临时目录里的真仓库和本地裸仓库执行；需要“带主机名的远端”时用绑定 `127.0.0.1` 的 `git daemon`。不访问任何外网。
3. **不靠 sleep 同步**：等待一律用 `waitForEvent(predicate, timeoutMs)`。协议超时通过 `AdapterDeps` 注入，测试里调成几百毫秒。
4. **Linux 与 macOS 都要过**：CI 跑 Ubuntu，owner 在 macOS 上跑。检查进程是否还在用 `process.kill(-pgid, 0)` 是否抛 `ESRCH`，不解析 `ps` 输出。残留清理那一支除外，它本来就要调 `ps`（[adapter-interface.md](adapter-interface.md) §8.3）。
5. **测试数据不含真实信息**：域名一律用 `*.example`，token 用明显的短占位符；从真实 Agent 录制的夹具必须先脱敏（§3.2）。
6. **每修一个 bug 先补一个能复现它的测试。**
7. 数据库是临时目录里的 `hub.db`，用 [data-model.md](data-model.md) §5 的手写迁移打开。不生成数据库客户端，不连远端数据库。

## 2. 分层

| 层               | 工具                                              | 位置                             | 内容                                                                                                             | CI  |
| ---------------- | ------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --- |
| 契约单测         | vitest（同 `packages/shared`）                    | `contract/src/**/*.test.ts`      | zod schema 的正反例；事件、DTO 的序列化往返                                                                      | 是  |
| 侧车单测         | jest + ts-jest（同 `apps/cardhub/api`）           | `server/src/**/*.spec.ts`        | 状态机、调度器、增量合并、脱敏、`agentEnv`、`checkPushTarget`、hook 脚本、配置校验、错误映射、`node:sqlite` 迁移 | 是  |
| 适配器协议测试   | jest + 假 Agent 子进程                            | `server/test/adapters/*.spec.ts` | 每个适配器跑 §4 里属于它的行；含 `jsonrpc.spec.ts`、`supervisor.spec.ts`                                         | 是  |
| git 与工作区测试 | jest + 临时仓库 + 本地裸仓库 + `git daemon`       | `server/test/git/*.spec.ts`      | worktree、diff、不碰用户暂存区、应用到本地分支、§3.3 的 12 组 `pre-push`、推送目标                               | 是  |
| API 集成测试     | jest + supertest + `ws`                           | `server/test/api/*.spec.ts`      | 随机端口上的完整 Nest 应用（临时 `AGENT_HUB_HOME`、临时 `hub.db`）：鉴权、Host / Origin、幂等、`wait`、WS 续订   | 是  |
| 网页 Agent 测试  | jest + 假 `RemoteBranchGit` + 本地裸仓库          | `server/test/web/*.spec.ts`      | [web-agent.md](web-agent.md) §8 的人工协作行为：轮询、完成本轮、拉取失败。不打开浏览器                           | 是  |
| Hub UI 测试      | vitest + Testing Library（同 `apps/cardhub/web`） | `web/test/**/*.test.{ts,tsx}`    | [hub-ui.md](hub-ui.md) §7：布局、缓存、时间线、表单、对话框遮挡、Markdown 清洗、开发模式启动                     | 是  |
| 桌面壳行为测试   | vitest + `@tauri-apps/api/mocks` 的 `mockIPC`     | `web/test/desktop/*.test.ts`     | [desktop-shell.md](desktop-shell.md) §9 的 17 个行为。不编译 Rust                                                | 是  |
| 手工验收         | 清单                                              | §7                               | 真实 Codex / Qoder / AoneD、桌面壳、安全清单、本地郎端到端                                                       | 否  |

`desktop/` 不进 CI（D54）。Rust 在 owner 的 Mac 上只跑 `cargo check`，再加上 §7 和 [desktop-shell.md](desktop-shell.md) §10。

## 3. 单元与集成测试规格

### 3.1 假 Agent 与剧本

```text
server/test/
├── fakes/
│   ├── fake-codex.mjs
│   ├── fake-acp.mjs
│   ├── sdk-agent.mjs         # 只用 import type 之外的官方 SDK 做互通；运行在独立的 ESM 进程里
│   └── scenario.ts           # 下面的类型；假进程读同一份 JSON
├── fixtures/
└── helpers/                  # 临时 AGENT_HUB_HOME、临时仓库、git daemon、waitForEvent
```

剧本路径经 `FAKE_SCENARIO` 传入，并写进该次测试的 `envPassthrough`，用来证明白名单放行的是名单里的名字。

```ts
export type FakeStep =
  | {
      expect: string;
      match?: Record<string, unknown>;
      reply?: unknown;
      error?: { code: number; message: string };
    }
  | { notify: string; params: unknown }
  | { request: string; params: unknown; expectResult?: Record<string, unknown> }
  | { sleepMs: number }
  | { writeRaw: string }
  | { stderr: string }
  | { writeFile: string; content: string }
  | { exit: number }
  | { hang: true };

export interface FakeScenario {
  name: string;
  protocol: 'codex' | 'acp';
  exitOnStdinClose: boolean;
  ignoreSigterm?: boolean;
  spawnGrandchild?: boolean;
  echoEnvNames?: boolean;
  steps: FakeStep[];
}
```

`sdk-agent.mjs` 只走正常路径，证明 `AcpAdapter` 能和官方 SDK 的 Agent 互通。

### 3.2 夹具录制

- 来源：owner 在 Mac 上打开诊断开关后的 `transcripts/<taskId>.ndjson`（已经过 `redact`）。
- 导入：`pnpm --filter @agent-hub/server run fixtures:import <transcript> --agent codex --name <场景名>`，再脱敏一遍，存到 `server/test/fixtures/<agent>/<版本>/<场景名>.json`。
- 人工检查：没有真实用户名（换成 `/Users/dev`）、没有内网域名、没有公司代码。
- CI 扫描 `fixtures/`，对 [security.md](security.md) §5 的每一种模式断言零命中。
- [adapter-codex.md](adapter-codex.md) §11、[adapter-acp.md](adapter-acp.md) §10 里每个“已实测”的版本都要有夹具，回放必须通过。

### 3.3 传输、进程与数据库

- `server/test/adapters/jsonrpc.spec.ts`： [adapter-interface.md](adapter-interface.md) §7.3 列出的场景（多字节跨 chunk、错误、超时、非 JSON、超长行、真实子进程往返）。
- `server/test/adapters/supervisor.spec.ts`： [adapter-interface.md](adapter-interface.md) §8.5 列出的场景（登录 PATH、`resolveExecutable`、SIGKILL 升级、孙进程、残留进程、pid 被复用时跳过）。
- 每个测试文件一个临时 `AGENT_HUB_HOME`（`0700`），结束时删除。`jest` 的 `globalSetup` 对一个模板库执行一次 `migrate()`（[data-model.md](data-model.md) §5），各文件复制这份已迁移的 `hub.db`。用的是 `node:sqlite` 的 `DatabaseSync`，不是外部迁移命令。
- 侧车绑定随机端口，不占用 47821。
- `NODE_OPTIONS` 带 `--disable-warning=ExperimentalWarning`，避免 `node:sqlite` 的实验警告把用例输出弄脏。

### 3.4 网页 Agent

把 [web-agent.md](web-agent.md) §8 改写成 jest，不启动浏览器：

- 假 `RemoteBranchGit`：正常一轮、连续拉取失败只记第一次、强推改写、拉取卡住时停止立刻返回、停机、超时、开始时拉取失败、完成本轮的最后一次拉取卡住时停机、能力与恢复标记。
- 真 git：`PushService` 对本地裸仓库（`allowLocalRemotes` 且钩子环境 `AGENT_HUB_PUSH_ALLOW_LOCAL=1`）做准备、拉取、快进；[security.md](security.md) §3.3 的 12 组直接调生成的 `pre-push`。

### 3.5 桌面壳的 17 个行为测试

与 [desktop-shell.md](desktop-shell.md) §9 同一份，用 `mockIPC` 断言调用顺序，不编译 Rust：

1. 重启退避的四档延迟。
2. 侧车状态机六个场景：冷启动成功、`fatal`、就绪前退出、崩溃后自动重启、手动重启、`quit` 让侧车读到 stdin EOF。
3. `takeDevToken` 把 hash 里的 token 放进 `sessionStorage` 并改成 `#/`。
4. Bot 面板四个场景：未配置、`bot_open` 期间布局合并、遮挡计数、收起后隐藏。
5. 菜单快捷键注册。
6. 菜单栏标题：0 不显示，大于 0 显示数字。
7. 系统通知只在后台发。
8. `notificationFor` 的三类文案。
9. `openExternal` 拒绝 `file:`，浏览器模式走 `window.open`。

### 3.6 Hub UI

与 [hub-ui.md](hub-ui.md) §7、§8 第 2 条同一份。逻辑测试在 Node 里跑布局、`ApiError.issues`、WebSocket 关闭码、`applyTask`、时间线、补丁拆分、表单、筛选、设置辅助函数、`labels.ts`。jsdom 测试覆盖对话框遮挡、确认框“处理中”、Markdown 清洗，以及开发模式下 `AppShell` 从失败到主界面。

## 4. 错误路径矩阵

每一行都要有测试，测试名以编号开头，例如 `it('[E23] stdin 关闭后不退出的 Agent 被按进程组结束', …)`。步骤 2 加一个检查脚本：解析本表的编号，确认每个编号至少出现在一个测试名或 §7 的手工项里，接进 `pnpm test`。手工项（层为 M）在脚本里列入白名单，不要求 CI 里有同名 `it`。

层：U 单测，A 适配器，G git，I API，W 网页 Agent，M 手工。

### 4.1 进程与握手

| 编号 | 场景             | 层  | 注入方式                                                      | 期望                                                                           |
| ---- | ---------------- | --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| E01  | 可执行文件不存在 | A   | profile 的 `command` 指向不存在的路径                         | 健康状态 `unavailable`；创建任务 `409 AGENT_UNAVAILABLE`                       |
| E02  | 启动后立即退出   | A   | 剧本第一步 `exit: 1`，之前写 stderr                           | `AGENT_SPAWN_FAILED`，`detail` 带 stderr 尾部；任务 `failed`                   |
| E03  | 握手无响应       | A   | 剧本 `hang`                                                   | `AGENT_HANDSHAKE_TIMEOUT`，进程组结束，没有残留                                |
| E04  | 协议版本不支持   | A   | ACP `initialize` 返回不支持的 `protocolVersion`               | `AGENT_PROTOCOL_UNSUPPORTED`，健康状态 `unavailable`                           |
| E05  | 未登录           | A   | Codex `account/read` 返回 `account: null`；ACP 按 D60 的信号  | 健康 `auth_required`；创建任务 `409 AGENT_AUTH_REQUIRED`；没有调用登录方法     |
| E06  | 子进程环境       | A   | 父进程放 `GITHUB_TOKEN`、`SSH_AUTH_SOCK`，剧本 `echoEnvNames` | 回显里没有这两个；有 `GIT_ALLOW_PROTOCOL`；`FAKE_SCENARIO` 因 passthrough 放行 |

### 4.2 协议

| 编号 | 场景                       | 层  | 注入方式               | 期望                                                                                |
| ---- | -------------------------- | --- | ---------------------- | ----------------------------------------------------------------------------------- |
| E07  | stdout 出现非 JSON 行      | A   | `writeRaw: "hello"`    | 跳过该行、记 warning，后续帧照常处理                                                |
| E08  | 截断的 JSON / 超过单行上限 | A   | 半个对象；Codex 超长行 | 前者同 E07；后者 `AGENT_PROTOCOL_ERROR`，Codex 共享进程重启，相关任务 `interrupted` |
| E09  | 未知 id 的响应             | A   | 不存在的 `id`          | 丢弃并记 warning                                                                    |
| E10  | 普通请求超时               | A   | `model/list` 不回复    | 模型列表为空并提示，不影响已在运行的任务                                            |
| E11  | 未知通知                   | A   | `notify` 一个新方法    | 忽略，每种只记一次 debug                                                            |
| E12  | stderr 大量输出            | A   | 循环写 10 MB stderr    | 不阻塞 stdout；日志只留末尾                                                         |
| E13  | stdin 写入背压             | A   | 假进程不读 stdin       | 等 `drain` 后继续，不丢数据                                                         |

### 4.3 轮与审批

| 编号 | 场景                         | 层  | 注入方式             | 期望                                                          |
| ---- | ---------------------------- | --- | -------------------- | ------------------------------------------------------------- |
| E14  | 正常一轮                     | A   | 增量 + 工具 + 结束   | `queued → preparing → running → completed`；`seq` 连续        |
| E15  | 一次审批，批准               | A   | 中途 `request` 审批  | `awaiting_approval`；`allow_once` 映射正确；回到 `running`    |
| E16  | 拒绝                         | A   | 决定 `reject`        | Codex `decline`、ACP `reject_once`；工具 `declined`；本轮继续 |
| E17  | 同时多个审批                 | A   | 连发两个             | 两个都决定后才回到 `running`                                  |
| E18  | ACP 没有 `reject_once`       | A   | 选项只有 allow       | 决定只有允许类和 `cancel_turn`                                |
| E19  | 桥接 token 审批              | I   | 默认 token 调审批    | `403 FORBIDDEN_SCOPE`；审批仍待决                             |
| E20  | 重复决定                     | I   | 同一审批决定两次     | 第二次 `409 APPROVAL_NOT_PENDING`                             |
| E21  | 用量上限 / 上下文 / 上游错误 | A   | 剧本返回对应错误     | 对应错误码；`prompt()` 不 reject；任务 `failed`               |
| E22  | 不支持的模型                 | I   | 创建任务时指定列表外 | `400 MODEL_NOT_SUPPORTED`，不创建任务                         |

### 4.4 取消与进程结束

| 编号 | 场景                   | 层  | 注入方式                   | 期望                                                  |
| ---- | ---------------------- | --- | -------------------------- | ----------------------------------------------------- |
| E23  | stdin 关闭后不退出     | A   | `exitOnStdinClose: false`  | 进程组被 SIGTERM；`process.kill(-pgid, 0)` 抛 `ESRCH` |
| E24  | 忽略 SIGTERM           | A   | `ignoreSigterm: true`      | 等待期满后 SIGKILL                                    |
| E25  | Agent 派生的子进程     | A   | `spawnGrandchild: true`    | 孙子进程随进程组结束                                  |
| E26  | 停止本轮，Agent 响应   | A   | 返回 `cancelled`           | 未决审批按协议取消；任务 `cancelled`                  |
| E27  | 停止本轮，Agent 不响应 | A   | `hang`                     | ACP 结束进程组；Codex 只取消该 turn，共享进程不被杀   |
| E28  | 排队中、准备中取消     | U   | 槽位占满时创建并取消       | 直接 `cancelled`；准备中已建的 worktree 保留          |
| E29  | Codex 共享进程崩溃     | A   | 两个任务运行中 `exit: 137` | 两个任务 `interrupted`；退避后 `thread/resume` 成功   |

### 4.5 恢复

| 编号 | 场景                 | 层  | 注入方式                                              | 期望                                                                    |
| ---- | -------------------- | --- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| E30  | 侧车被强杀时正在审批 | I   | 子进程侧车进入 `awaiting_approval` 后 SIGKILL，再启动 | 任务 `interrupted`；未决审批 `expired`；假 Agent 被清理；追问能新建一轮 |
| E31  | 原生会话无法恢复     | A   | ACP 不声明 `resume` / `load`                          | 追问 `409 SESSION_NOT_RESUMABLE`                                        |
| E32  | 追问进行中的任务     | I   | `running` 时追问                                      | `409 TASK_BUSY`                                                         |
| E33  | 数据库迁移失败       | I   | 把模板库的 `user_version` 改成比程序新                | 启动失败，fatal `DB_MIGRATION_FAILED`，错误信息里有备份位置             |
| E68  | 壳进程消失           | I   | 子进程侧车等到 ready 后关掉 stdin                     | 10 秒内退出；假 Agent 进程组不在；下次启动该任务为 `interrupted`        |

### 4.6 工作区与 git

| 编号 | 场景                       | 层  | 注入方式                          | 期望                                                 |
| ---- | -------------------------- | --- | --------------------------------- | ---------------------------------------------------- |
| E34  | 路径不是 git 仓库          | I   | 注册临时空目录                    | `400 REPO_INVALID`                                   |
| E35  | `worktreeSetup` 失败或超时 | G   | `["false"]` / 长时间 sleep        | `WORKSPACE_SETUP_FAILED`，worktree 保留              |
| E36  | `in_place` 写任务互斥      | U   | 同一目录先后创建写任务和只读任务  | 后者排队                                             |
| E37  | 只读任务改了工作区         | A   | ACP 剧本 `writeFile`              | `notice` + `readOnlyViolation`；不回滚               |
| E38  | diff 的各种情况            | G   | 未跟踪、二进制、重命名、超过 5 MB | 统计正确；二进制不内联；超限只留统计；用户暂存区不变 |
| E39  | ACP 写文件越界             | A   | 路径在 worktree 外或 `.git/` 内   | 向 Agent 返回错误；文件未被写                        |
| E40  | 应用到本地分支             | G   | 原仓库脏；制造冲突                | 前者拒绝；后者 `git merge --abort`，原仓库恢复       |

### 4.7 推送守卫与脱敏

| 编号 | 场景                    | 层  | 注入方式                                                         | 期望                                                                       |
| ---- | ----------------------- | --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| E41  | Agent 环境里推送        | G   | `agentEnv()` 之后 `git push` 到 `git://127.0.0.1`                | 失败，`transport 'git' not allowed`；裸仓库没有新引用                      |
| E42  | `insteadOf` 改写        | G   | 全局改写把远端指到 daemon                                        | 同 E41                                                                     |
| E43  | `pre-push`              | G   | [security.md](security.md) §3.3 的 12 组；另测 `commit-msg` 转发 | 12 组与表一致；仓库自己的 `commit-msg` 被调用；`pre-push` 不转发           |
| E44  | Hub 推送到 GitHub 主机  | G   | `internal` 被改写成 `https://github.com/...`                     | `checkPushTarget` 拒绝，`GIT_PUSH_BLOCKED`，没有连接；审计 URL 无 userinfo |
| E45  | 非 `agent-hub/*` 或强推 | G   | 直接调用 `PushService`                                           | 拒绝                                                                       |
| E46  | 远端跟踪分支变化        | G   | 轮中用不带守卫的环境推一次命名远端                               | 轮后审计 `security.remote_ref_changed`，并有 warning `notice`              |
| E47  | 脱敏                    | U   | [security.md](security.md) §5 的每种模式                         | 日志、transcript、桥接响应是 `«已脱敏»`；Hub UI 的 REST 响应保持原文       |
| E48  | 目录越界                | I   | 仓库路径不在已注册列表                                           | `400 REPO_INVALID`                                                         |

### 4.8 本地 API

| 编号 | 场景                  | 层  | 注入方式                                       | 期望                                                                                                |
| ---- | --------------------- | --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| E49  | Host / Origin / token | I   | 非法 Host；非法 Origin；无 token；吊销的 token | `421 HOST_FORBIDDEN`；`403 ORIGIN_NOT_ALLOWED`；`401`；WS `4401`                                    |
| E50  | 幂等键                | I   | 桥接 token 同一键发两次；同一键不同正文        | 同一个任务；`409 IDEMPOTENCY_CONFLICT`。Hub UI 不发这个头（D67）                                    |
| E51  | 长轮询                | I   | `wait` 超时；期间本轮结束                      | `reached: false`；`reached: true`                                                                   |
| E52  | WS 续订               | I   | 断开后用最后的 `seq` 重连                      | 不重不漏                                                                                            |
| E53  | 慢消费者              | I   | 客户端不读，阈值调小                           | `4008` 关闭；重连后数据完整                                                                         |
| E54  | 排队已满              | I   | 调小 `maxQueuedTasks`                          | `503 QUEUE_FULL`                                                                                    |
| E55  | 桥接方写任务          | I   | 桥接 token 创建写任务；再传 `in_place`         | 省略工作区时直接 `queued` 且为 worktree（D45）；`in_place` 为 `403 BRIDGE_IN_PLACE_WRITE_FORBIDDEN` |

### 4.9 网页 Agent

人工协作，不驱动页面。

| 编号 | 场景           | 层  | 注入方式                           | 期望                                                                                         |
| ---- | -------------- | --- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| E56  | 轮询           | W   | 假远端每隔一次多一个提交           | 镜像 ref 更新；`remote.updated`；diff 用镜像 ref，不联网                                     |
| E57  | 完成本轮       | W   | 调用 `remote/done`                 | 最后拉一次；总结写入；任务按提交情况进入终态                                                 |
| E58  | 拉取失败       | W   | `fetchHead` 连续失败               | 只提示一次；任务保持 `running`；完成本轮时再拉一次仍失败则按 [web-agent.md](web-agent.md) §6 |
| E59  | 轮询超时       | W   | 调小 `maxTurnMinutes`              | 最后拉一次；本轮 `failed`（`WEB_TURN_TIMEOUT`）                                              |
| E60  | 停止本轮       | W   | 拉取卡住时取消                     | 立即返回，不再轮询                                                                           |
| E61  | 开始时拉取失败 | W   | 准备阶段之后第一次拉取失败         | 按 §6 的错误码失败或保持可重试，不打开浏览器                                                 |
| E62  | 远端分支已存在 | W   | 裸仓库里已有指向别的提交的同名分支 | 不强推；准备失败并说明；换短号重试一次成功                                                   |

### 4.10 桌面壳

| 编号 | 场景                 | 层  | 期望                                                                    |
| ---- | -------------------- | --- | ----------------------------------------------------------------------- |
| E63  | 找不到 Node 22       | M   | 错误页说明如何安装，不白屏                                              |
| E64  | 端口被占用或已有实例 | M   | 已有实例聚焦旧窗口；端口被别的程序占用时显示错误页                      |
| E65  | 侧车崩溃             | M   | 顶栏“本地服务已断开，N 秒后自动重启”；5 分钟内失败 5 次后停止并给出重试 |
| E66  | 本地郎页面打不开     | M   | Bot 面板显示自己的错误；Hub UI 仍可用                                   |
| E67  | Bot 页面调用 IPC     | M   | 失败                                                                    |

## 5. CI

步骤 1 在 `.github/workflows/ci.yml` 里只做这些：

- Agent Hub 不加数据库客户端生成步骤，也不加浏览器安装步骤。Cardhub 现有的那两步保持不动。
- `pnpm build` 排除 `@agent-hub/desktop`（与 `@cardhub/native` 一样）。`desktop/` 不进 CI。
- Agent Hub 的测试不读 `turbo.json` 里 `test.env` 的变量。需要的配置写在 jest / vitest 配置和测试辅助代码里。
- 侧车的 `test` 脚本带 `NODE_OPTIONS=--disable-warning=ExperimentalWarning`（[data-model.md](data-model.md) 对 [milestones.md](milestones.md) §2 的约定）。
- Ubuntu 镜像自带 git，`git daemon` 是 git 的一部分。

## 6. 测试数据规范

- 域名只用 `*.example` 或 `<内网 git 域名>`。
- token、密钥用短占位符。不要写出能被 [security.md](security.md) §5 的模式命中的长串，文档扫描也不接受 `ahu_` / `ahb_` 后面跟上长串的样子。
- 临时仓库的提交作者用 `dev@example.com`。
- 夹具路径里的用户目录写成 `/Users/dev`。
- 每个测试结束删除自己的 `AGENT_HUB_HOME` 和临时仓库。

## 7. 手工验收

每个步骤结束时，若该步的检查点写了“手工”，就在 owner 的 Mac 上执行下表，把结果（Agent 版本、macOS 版本）贴进 PR。最终一步把整张表走完。

| 项目         | 内容                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 桌面壳       | [desktop-shell.md](desktop-shell.md) §10 全部，外加 E63–E67                                                                                              |
| 安全         | [security.md](security.md) §10 全部                                                                                                                      |
| Codex        | 健康为 `ready`；模型列表与 ChatGPT 应用里的一致；只读任务出结果；一次审批（批准与拒绝各一次）；停止本轮；侧车重启后恢复；`threadSource: "user"` 的可见性 |
| Qoder        | 同 Codex 的前五项；任务结束、闲置超时后进程不在；只读任务的模式守卫生效（D37、D38）                                                                      |
| AoneD        | 打开页面、复制提示词、轮询看到新提交、点完成本轮、本地 diff 正确；GitHub 上没有新分支                                                                    |
| 本地郎端到端 | 本地郎经 API 派任务 → `wait` → 取结果与 diff；Hub 里看到实时输出；审批只能在 Hub 里做                                                                    |
| 录制夹具     | 新验收过的 Agent 版本，按 §3.2 录制至少“正常一轮”和“一次审批”两个夹具                                                                                    |

Rust 只要求 `cargo check` 通过。不在 CI 里编译桌面壳。
