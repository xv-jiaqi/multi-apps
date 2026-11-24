# PR3 证据：Qoder 适配器（ACP）

2026-11-24 在开发机（Linux）上采集。侧车跑的是 `node dist/main.js`（本 PR 的构建产物），Qoder 由假 ACP 进程 `test/fakes/fake-acp.mjs` 扮演，帧格式照 Qoder CLI 1.1.80 实测（adapter-acp.md §3、§10）。所有 token 已脱敏（`<redacted>` / `<uiToken>` / `<bridgeToken>`）。

复现：`pnpm --filter @agent-hub/server build`，然后在本目录跑 `./run-fake-qoder.sh normal 01-fake-qoder-dispatch` 和 `./run-fake-qoder.sh logged-out 02-fake-qoder-logged-out`。剧本由 `qoder-scenario.mjs` 生成。

| 文件                           | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-fake-qoder-dispatch.txt`   | 启动 ready 行，监听只有 `127.0.0.1:47821`；`GET /agents` 里 qoder 为 ready、1.1.80，模型来自探测会话（`modelsSource: "session"`）。派发只读任务：`curl -sv -u` 的执行审批走 `proceed_once`；工具输出里的 `Authorization: Basic ZGVt…` 在桥接 token 的 `/events` 里变成 `Authorization: «已脱敏»`（审查 6041423500 第 2 条），UI token 看到原文。追问一轮：改 README 的审批被拒，Hub 回 `cancel`；Agent 自己切到 `yolo` 后 Hub 发 `session/set_config_option mode=default`，并发出 `MODE_RESTORED` 通知。仓库 `git status` 干净。最后列出 Hub 发给假 Qoder 的全部请求和回复。SIGTERM 后侧车退出码 0，没有残留的 fake-acp 进程。 |
| `02-fake-qoder-logged-out.txt` | 假 Qoder 对 `session/new` 回 `-32000 Authentication required`（与未登录的 qodercli 1.1.80 一致）。`GET /agents` 显示 `auth_required`，并给出中文登录提示。派发返回 201，任务在 preparing 阶段转为 `failed`，`lastError.code` 为 `AGENT_AUTH_REQUIRED`（local-api §5）。帧日志里没有 `authenticate` 请求，Hub 不替用户登录。                                                                                                                                                                                                                                                                                                    |
| `codex-env-policy.md` / `.mjs` | PR3 待办 5：用真 codex-cli 0.164.0 验证 `shell_environment_policy` 下 git 守卫变量仍然保留。结果见该文件里的 15 行表格。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**没有做真实 Qoder 验收。** 开发机上没有 Qoder 账号和凭据，所以没有真 qodercli 跑完一轮的记录。上面的帧序列只能证明 Hub 一侧按 adapter-acp.md 的约定收发。真实验收需要有 Qoder 账号的机器，步骤是：在 `config.json` 里把 qoder 的 `command` 指向 `qodercli`，`args` 设为 `["--acp"]`，再重跑本脚本的 HTTP 部分。

本机没有 `lsof`，监听检查用 `ss -ltnp` 代替。

## 扣留与脱敏复现（审查 6042967785 第 6 条、e2ee818 复审 ②③）

2026-11-25 采集。同样是真侧车 `node dist/main.js` + `test/fakes/fake-acp.mjs`。跑完后用 `check-db.mjs` 从 `hub.db` 取出这个任务全部落库事件，按桥接方的视角检查：每条事件先单独 `redact()`，再看单条、同一路相邻两条拼接、整路拼接里有没有任何密钥主体的 8 字符片段；另外用桥接 token 读 REST `/events`，在整个响应里找片段。`hub.db` 里存的是原文（Hub UI 看原文），所以同时列出原文里密钥是否完整落在同一条事件里。输出里的密钥都是按固定花样生成的假值。

复现：`pnpm --filter @agent-hub/server build`，然后 `./run-holdback-repro.sh <a|b|c|d> <输出名>`，剧本由 `holdback-scenario.mjs` 生成。

| 剧本 | 输入                                                                                                  | 本 PR（`0X-holdback-*.txt`）                                                  | e2ee818（`e2ee818-holdback-*.txt`）       |
| ---- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| a    | 1 MiB 截断：`y y …` 加跨块的 `ahu_` token（审查原样），以及整段无空白的同一情形；截断点落在 token 里  | 0 泄漏；两路都在 token 前截断，带 truncated 标记                              | 0 泄漏（第 3 轮已修）                     |
| b    | 工具 A 扣着半截 JWT，17 路各 64000 无空白、扣留合计超过 1 MiB，然后 A 写完                            | 0 泄漏；A 的 JWT 完整在一条事件里；cmd0 整路丢弃 + `OUTPUT_OMITTED`           | 0 泄漏（第 3 轮已修）                     |
| c    | continue：70000 字符无空白长行，没写完的 JWT 跨在强切点上（c1）；没写完的“JWT”本身超过 64 KiB（c2）   | 0 泄漏；c1 JWT 完整在一条事件里；c2 放出 `ok "` 后整路丢弃 + `OUTPUT_OMITTED` | **9 处泄漏**，桥接响应里 3 个密钥都有片段 |
| d    | `head -c 400 id_rsa`：没闭合的私钥分三块到达后结束（d1）；`origin\txhttps://deploy:<pw>@…` 跨块（d2） | 0 泄漏；d1 整条 `«已脱敏»`；d2 变成 `xhttps://git.example.com/r.git`          | **4 处泄漏**，私钥正文和密码在桥接响应里  |
