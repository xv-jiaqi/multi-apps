# PR2 证据：Codex 适配器 + 任务核心 + REST/WS

2026-11-24 在开发机（Linux）上手工采集，侧车跑的是 `node dist/main.js`（本 PR 的构建产物）。所有 token 已脱敏（`<redacted>` / `<uiToken>`）。

| 文件                               | Agent                                                                        | 内容                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-fake-readonly-dispatch.txt`    | **假 app-server**（`test/fakes/fake-codex.mjs`，场景 `codex-readonly-demo`） | 启动 ready 行；监听只有 `127.0.0.1:47821`；`GET /agents`（ready、0.164.0）；只读派发 → `wait` → 15 条事件（状态、输出流里是在仓库里**真实执行**的 `git log -3 --oneline`）→ `result` → `diff`（0 文件）；仓库 `git status` 干净；SIGTERM 正常退出          |
| `02-fake-violation-approval.txt`   | 假 app-server（场景 `codex-readonly-violation`）                             | 只读任务里 Agent 申请写文件 → `approval.requested`；bridge token 决定审批被拒（缺 `approvals:decide`，403）；UI token `allow_once` → 文件写入；`diff.updated` 2 个文件 + `READ_ONLY_VIOLATION` 告警，`readOnlyViolation: true`                             |
| `03-real-codex-no-credentials.txt` | **真 codex-cli 0.164.0**（`CODEX_HOME` 指向空目录，未登录）                  | 真进程握手成功：`initialize` / `account/read` / `model/list` 跑通，health `auth_required`；派发任务按 adapter-codex §5 直接 `failed`，错误 `AGENT_AUTH_REQUIRED`，不建 thread                                                                              |
| `04-ws-subscription.txt`           | 假 app-server                                                                | WS：`auth` → `ready`；订阅 `tasks` 收到对象变化；订阅 `task`（`afterSeq: 0`）回放 seq 1–15；ready 之后再发 `auth` → close **4400**                                                                                                                         |
| `05-ws-slow-consumer-4008.txt`     | 假 app-server（40 条命令各 1 MB 输出）                                       | 审查 BLOCK 2 的修复：默认 8 MB 阈值，客户端订阅 `task` 后不读 → 侧车以 **4008** 关闭；`afterSeq` 重连后 127/127 条、seq 连续不重不漏                                                                                                                       |
| `06-bridge-redaction.txt`          | 假 app-server（输出、文件、消息里带假密钥，diff 约 680 KB）                  | 审查 BLOCK 1 的修复：桥接 token 读 `/events`、`/result`、`/diff`（json / patch）都看不到原文，UI token 看得到；桥接方 diff 按文件边界截断到 512 KB 以内，`truncated: true` / `X-Agent-Hub-Truncated: true`；`audit_log` 记 `bridge.diff_read`，UI 读取不记 |

没有 Codex 账号 / OPENAI key，所以**没有真 Codex 跑完一轮的记录**；真实一轮的事件流由假 app-server 按 0.164.0 实测协议模拟（假进程里的命令是真执行的）。

本机没有 `lsof`（无 root 装不了），监听检查用 `ss -ltnp` 代替。同机另有两个 `ah-rev` 侧车（127.0.0.1:47891/47892，PR1 审查实例，与本 PR 无关）。
