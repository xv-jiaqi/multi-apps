# 风险与待决问题

> 上级文档：[../README.md](../README.md)。风险写明触发条件、影响和缓解办法；待决问题都给了**默认方案**——owner 没有回复时，实现 Agent 按默认方案做，不要停下来等。新发现的风险和问题按编号续写，不改已有编号（其他文档按编号引用）。

## 1. 风险

| 编号 | 风险                                                                                               | 影响                                   | 缓解                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | Codex app-server 协议随版本变化（字段改名、方法废弃、新的必填字段）                                | Codex 任务失败或事件丢失               | 类型由 `codex app-server generate-ts` 生成并入库；协议兼容表 + 录制夹具回放；健康检查记录版本，遇到兼容表里没有的版本时在界面提示“未验证的版本”；只用稳定接口（`experimentalApi: false`）                       |
| R2   | `threadSource: "user"` 不能让会话出现在 ChatGPT 应用里，或行为改变                                 | 场景 S8 不成立                         | 能力开关 `supportsUserVisibleSessions` 只在实测通过的版本上为真（AH-104）；不成立时 S8 降级为“只在 Hub 里查看”，其他功能不受影响                                                                                |
| R3   | Qoder 的 ACP 实现不完整或不标准（模型字段非标准、stdin 关闭不退出、不支持恢复）                    | 模型选择、恢复不可用；进程泄漏         | profile 收纳怪癖，不复制适配器；AH-301 先探测；进程结束一律按进程组处理（adapter-acp.md §7）；不支持恢复时明确返回 `TASK_NOT_RESUMABLE`                                                                         |
| R4   | Tauri 多 WebView 依赖 `unstable` 特性，小版本之间 API 或行为变化（位置、焦点、缩放、隐藏）         | 内嵌本地郎的布局出错，甚至编译失败     | `Cargo.lock` 锁版本；所有 `unstable` 调用只在 `bot_panel.rs`、`window.rs`；升级 Tauri 单独提 PR 并跑 desktop-shell.md §10；退路一：Bot 面板改为吸附在主窗口左侧的独立无边框窗口；退路二：用系统浏览器打开本地郎 |
| R5   | 本地郎页面不适合被内嵌（拦截 WebView 的 UA、SSO 走弹窗或跳转到未列入白名单的域名、依赖浏览器扩展） | Bot 面板无法登录或无法使用             | 原生子 WebView 是顶层浏览上下文，不受 `X-Frame-Options` / `frame-ancestors` 限制；可覆盖 UA；`bot.authOrigins` 允许登录小窗；最后退路同 R4                                                                      |
| R6   | AoneD 没有官方 API，页面自动化脆弱，或内部规范不允许自动化操作                                     | M4 范围缩小或取消                      | 方案 A（官方 API / CLI）优先；DOM 漂移检测与截图；最低验收只依赖 git 结果；先由 owner 确认合规（Q4）                                                                                                            |
| R7   | 没有沙箱的 ACP Agent 在自己的命令里清掉 git 守卫变量后推送                                         | 违反“绝不向 GitHub 推送”               | security.md §3.6：子进程没有 SSH agent 和 GitHub token、`gh` 未登录；建议禁用 `origin` 的 push URL（Q10）；ACP 任务默认只读；命令执行需审批时由人把关；事后检测与告警。残余风险需 owner 知悉                    |
| R8   | Agent 进程或其子进程泄漏                                                                           | 占用资源；旧会话还在后台修改文件       | 进程组启动与结束；pgid 和启动时间落库，侧车启动时核对后清理；E23–E25、E30、E68 覆盖                                                                                                                             |
| R9   | 公司 MDM / Gatekeeper 拦截未签名或 ad-hoc 签名的 .app                                              | 无法以 .app 方式启动                   | M0–M4 从源码运行（`pnpm dev:agent-hub`）不受影响；M5 打包前与 IT 确认，必要时申请公司签名证书                                                                                                                   |
| R10  | 侧车依赖系统 Node，版本漂移（nvm 切换、Homebrew 升级）                                             | 侧车启动失败或行为不同                 | 启动时检查 `node --version` ≥ 22；设置里可指定绝对路径；错误页给出修复办法；M5 评估把 Node 打进 .app（多出一个 Node 可执行文件的体积）                                                                          |
| R11  | 事件量过大（长时间运行、海量命令输出）拖慢 SQLite 和界面                                           | 卡顿、磁盘占用                         | 增量合并、单工具输出落库上限、WAL、保留策略（data-model.md §6）；界面虚拟列表                                                                                                                                   |
| R12  | 本地郎取走的结果与 diff 进入其背后大模型的上下文                                                   | 公司代码流出到该模型的服务商           | 默认 token 的 scope 可去掉 `diff:read`；`maxBridgeDiffBytes` 截断；统一脱敏；按 token 记录读取；由 owner 决策（Q6）                                                                                             |
| R13  | worktree 准备慢或失败（依赖安装需要联网、磁盘占用大）                                              | 写任务启动慢；`WORKSPACE_SETUP_FAILED` | `worktreeSetup` 按仓库配置，默认离线安装（同一磁盘卷上 pnpm 从全局存储硬链接依赖文件，多个 worktree 不重复占用空间）；超时 10 分钟；失败时保留 worktree 方便排查；归档后按保留策略清理                          |
| R14  | Agent 自己对审批有超时，人还没决定 Agent 就放弃了                                                  | 审批卡片失效，人做的决定没有效果       | 收到 Agent 的撤回信号（Codex `serverRequest/resolved`、ACP 本轮结束）时产出 `approval.withdrawn`，卡片变灰并说明原因；系统通知提醒尽快审批                                                                      |

## 2. 待决问题

### Q1 应用名称与标识

- **问题**：应用显示名、bundle identifier、`AGENT_HUB_HOME` 位置。
- **默认**：显示名 “Agent Hub”；bundle identifier `com.multiapps.agenthub`；`AGENT_HUB_HOME` 为 `~/Library/Application Support/AgentHub`。

### Q2 本地郎能否审批

- **问题**：是否允许本地郎代替人批准或拒绝 Agent 的权限请求。
- **默认**：不允许。默认 token 不带 `approvals:decide`；owner 可以在设置页给某个 token 加上，加的时候界面二次确认并写审计。

### Q3 本地郎运行在哪里

- **问题**：本地郎的运行时在这台 Mac 上，还是在云端（只在 Bot 面板里显示网页）？Hub 的 API 只监听 `127.0.0.1`，云端进程访问不到。
- **默认**：要求本地郎的“工具调用”部分跑在这台 Mac 上（一个本地进程，读取 `bridge-token` 文件，调用本地 API）。如果本地郎只能跑在云端，由桥接方在本机提供一个连接器进程（主动向外连接到本地郎的云端，再转调本地 API）；Hub 不开放任何远程入口，也**不**让 Bot 页面里的脚本直接调用本地 API（那样 token 会暴露给该网页上的任何脚本）。
- 同时决定接入方式：WebSocket 订阅、`wait` 长轮询，还是 MCP（决定 AH-503 做不做）。默认 `wait` 长轮询（最适合“工具调用”式的 Bot），WebSocket 作为可选项。

### Q4 AoneD 的接入方式与合规

- **问题**：AoneD 有没有官方 API 或命令行？公司 SSO 是否依赖浏览器扩展或本机客户端？内部规范是否允许用自动化脚本操作 AoneD 页面？
- **默认**：AH-401 先查；有官方接口就用方案 A；只能走页面时，在 owner 确认合规之前，M4 只做到“推送任务分支 + 在专用浏览器窗口里人工操作 AoneD + Hub 拉取结果算 diff”，不自动点击页面。

### Q5 “在 ChatGPT 中可见” 默认开还是关

- **问题**：Codex 任务是否默认以用户可见的方式创建（会出现在 ChatGPT 应用的 Codex 列表里）。
- **默认**：实测通过后默认开（便于在 ChatGPT 里接着聊）；桥接方派发的任务也一样，可在创建请求里关掉。

### Q6 本地郎可以取走哪些内容

- **问题**：本地郎背后的模型是否被允许看到公司代码（diff、命令输出）。
- **默认**：允许，带 512 KB 截断和脱敏，读取按 token 记录；owner 若不允许，在设置里去掉默认 token 的 `diff:read`，并打开 `security.bridgeSummaryOnly`（见 [local-api.md](local-api.md) §2）。

### Q7 桥接方创建的写任务是否需要人确认

- **问题**：本地郎派发的可写任务，是直接开始，还是先等人在 Hub 里确认。
- **默认**：需要确认（`security.bridgeWriteRequiresConfirmation: true`），确认之前任务为 `pending_confirmation`，24 小时未确认自动取消。

### Q8 写任务默认的工作区

- **问题**：写任务默认在独立 worktree 里做，还是直接改原仓库。
- **默认**：worktree；本仓库的 `worktreeSetup` 为 `pnpm install --offline --frozen-lockfile`。选 `in_place` 要显式勾选并二次确认。

### Q9 是否支持 macOS 13

- **问题**：Bot 面板的独立数据存储需要 macOS 14。
- **默认**：最低 13，推荐 14+；13 上 Bot 面板使用默认存储，设置页提示。Hub UI 不依赖 Cookie，所以共用存储不影响 Hub 自身。

### Q10 内网 git 主机与 `origin` 推送

- **问题**：`internal` 远端的主机名（填进 `allowedPushHosts`）；是否同意在注册仓库时把 `origin` 的 push URL 设为 `DISABLED`。
- **默认**：主机名由 owner 在设置里填写（文档与代码里不出现真实内网域名）；禁用 `origin` 推送作为体检建议，由 owner 点确认后执行，不自动改。

### Q11 Codex 的 `clientInfo` 是否需要登记

- **问题**：OpenAI 建议企业集成登记 `clientInfo.name`；个人在公司机器上使用是否需要。
- **默认**：不登记，`clientInfo.name` 用 `agent_hub`；如果公司对 Codex 的使用有合规登记要求，由 owner 判断。

### Q12 保留期限

- **问题**：事件、transcript、diff、归档后 worktree 保留多久。
- **默认**：按 [data-model.md](data-model.md) §6——增量事件与 transcript 在任务结束或归档满 30 天后删除（完成事件、状态、审批、diff 事件保留）；归档满 30 天后移除 worktree（分支保留）；diff 补丁、任务、审计一直保留到用户删除任务。天数在设置里可改。

### Q13 是否实现 ACP 的终端能力

- **问题**：ACP 的 `terminal/*` 能力（由客户端代为执行命令）要不要做。
- **默认**：M1–M5 不做（`clientCapabilities.terminal: false`），Agent 用自己的工具执行命令；理由是由 Hub 代为执行等于 Hub 自己要做沙箱。
