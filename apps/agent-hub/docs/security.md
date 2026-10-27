# 安全设计

> 上级文档：[../README.md](../README.md)。硬性要求：只在公司 Mac 本机运行；**绝不向 GitHub 推送**；凭据不外泄；默认只读沙箱；API 只监听 localhost 并鉴权。本文给出威胁模型、每条要求的多层控制、已知的残余风险和验收清单。

## 1. 资产

| 资产                | 在哪里                                             |
| ------------------- | -------------------------------------------------- |
| 公司源代码          | 本地仓库、worktree、diff 补丁、transcript          |
| 各 Agent 的登录凭据 | `~/.codex`、Qoder 等 CLI 自己的存储（Hub 不读）    |
| git 凭据            | 用户的 git 凭据助手（钥匙串）、SSH agent           |
| 内网 SSO 会话       | 网页 Agent 专用 Chrome profile                     |
| 本地郎对话的登录态  | Bot 子 WebView 的独立数据存储                      |
| Hub 自己的 token    | 内存里的 UI token；`bridge-token` 文件与库里的哈希 |

## 2. 威胁模型

| 编号 | 威胁                     | 场景                                                                                                          | 控制（章节）         |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| T1   | 代码被推到 GitHub        | Agent 自作主张 `git push`；提示词注入诱导推送；Hub 自己推错远端；用户的 `insteadOf` 改写把内网地址变成 GitHub | §3                   |
| T2   | 本机其他网页调用 Hub API | 浏览器里的恶意页面猜端口发请求；DNS rebinding                                                                 | §6                   |
| T3   | 本机其他进程调用 Hub API | 同用户下的其他程序直接请求 `127.0.0.1:47821`                                                                  | §4（必须持有 token） |
| T4   | 凭据泄露给 Agent 或日志  | 子进程继承了 `GITHUB_TOKEN`、`SSH_AUTH_SOCK` 等；日志、transcript、事件里出现 token                           | §4、§5               |
| T5   | Agent 越权改动           | 只读任务改了文件；可写任务改到工作区以外                                                                      | §7                   |
| T6   | Bot 页面拿到本机能力     | 本地郎页面（或被注入的脚本）调用 Tauri IPC                                                                    | §8                   |
| T7   | 桥接方权限过大           | 本地郎（或冒充它的进程）自动批准危险命令、让 Agent 进任意目录                                                 | §4.3                 |
| T8   | 代码随结果流出           | 本地郎把取到的 diff、输出带进其背后的大模型上下文                                                             | §9                   |
| T9   | 网页 Agent 会话被劫持    | Chrome 开了调试端口；专用 profile 被拷走                                                                      | web-agent.md §2、§5  |

## 3. 绝不向 GitHub 推送

多层控制，任何一层单独失效都不应导致推送成功。

### 3.1 第一层：Agent 子进程的 git 环境（最关键）

`GitGuard` 为每个 Agent 子进程生成以下环境变量（`ProcessSupervisor` 统一注入，适配器不能改）：

| 变量                                     | 值                                                                      | 作用                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GIT_ALLOW_PROTOCOL`                     | `file`                                                                  | git 只允许本机文件协议；`https`、`ssh`、`git` 传输一律被拒，fetch 与 push 都不行 |
| `GIT_TERMINAL_PROMPT`                    | `0`                                                                     | 不弹出交互式凭据提示                                                             |
| `GIT_ASKPASS`、`SSH_ASKPASS`             | 一个总是失败的脚本                                                      | 不让任何程序借此拿到密码                                                         |
| `GIT_CONFIG_COUNT` / `KEY_n` / `VALUE_n` | `core.hooksPath` = Hub 的 hooks 目录                                    | 见 §3.2                                                                          |
| `GH_CONFIG_DIR`                          | 一个空目录                                                              | `gh` CLI 处于未登录状态                                                          |
| 移除                                     | `SSH_AUTH_SOCK`、`GH_TOKEN`、`GITHUB_TOKEN` 等（§4.2 白名单之外的一切） | 子进程拿不到 SSH agent 和 GitHub token                                           |

**为什么不用 `url.<x>.insteadOf` / `pushInsteadOf` 改写 GitHub 地址**：设计时实测过（git 2.43），两者都不可靠：

- 用户已有的改写规则按“最长前缀优先”生效。全局配置里已有一条 `https://github.com/` 的 `insteadOf`（很常见，例如改写成带 token 或 SSH 的地址）时，注入的同长度规则没有生效，`git push` 仍然连到了 GitHub。
- `pushInsteadOf` 对显式配置了 `pushurl` 的远端不生效（git 文档如此规定）。

而 `GIT_ALLOW_PROTOCOL=file` 在同一环境下的实测结果：对 `origin`（含显式 `pushurl`）、直接写 `https://github.com/...`、`git@github.com:...`、`ssh://git@github.com/...` 的推送与 `fetch` 全部失败（`fatal: transport 'https' not allowed`），本地的 `status`、`commit`、`worktree add` 不受影响。它在 URL 改写之后、建立连接之前检查协议，与用户的改写规则无关。

### 3.2 第二层：Hub 的 hooks 目录

- `core.hooksPath` 指向 `<AGENT_HUB_HOME>/git-hooks/`。这会覆盖仓库自己的设置（本仓库的 husky 用的就是 `core.hooksPath`），所以这个目录里为**每一个**标准 hook 名放一个转发脚本，把调用交还给仓库原来的 hooks，保证 Agent 提交时 commitlint、lint-staged 照常运行。
- 原来的 hooks 目录在 hook 里现查：`git config --local --get core.hooksPath`（只读仓库自己的配置文件，不受环境变量覆盖），为空时用 `$(git rev-parse --git-common-dir)/hooks`。
- `pre-push` 先检查目标主机，不在白名单里就拒绝，然后才转发：

```sh
#!/bin/sh
# 由 Agent Hub 生成，配置变更时重写。参数：$1 远端名，$2 远端 URL。
allowed_hosts="__ALLOWED_PUSH_HOSTS__" # 生成时替换为空格分隔的主机名

host=$(printf '%s' "$2" | sed -E 's#^[a-z+]+://##; s#^[^@/]*@##; s#[:/].*$##')
if [ -n "$host" ]; then
  case " $allowed_hosts " in
    *" $host "*) ;;
    *)
      echo "agent-hub: 拒绝推送到 $host（远端 $1）" >&2
      exit 1
      ;;
  esac
fi

orig=$(git config --local --get core.hooksPath)
[ -n "$orig" ] || orig="$(git rev-parse --git-common-dir)/hooks"
case "$orig" in /*) ;; *) orig="$(git rev-parse --show-toplevel)/$orig" ;; esac
if [ -x "$orig/pre-push" ]; then
  exec "$orig/pre-push" "$@"
fi
exit 0
```

没有主机名的 URL（本机路径）放行：推送不会离开本机。

设计时用本机 `git daemon` 实测过这个脚本（git 2.43）：git 传给 `pre-push` 的 `$2` 是 **`insteadOf` 改写之后**的最终 URL，所以“白名单主机名被改写到别的主机”也会被拒绝；放行时能正确转发到仓库原来的 `pre-push`。`pre-push` 在连上远端之后、传输对象之前执行，因此它只是 §3.1 之后的兜底，不能替代 §3.1。

### 3.3 第三层：沙箱断网

- Codex：只读与可写任务的 `sandboxPolicy.networkAccess` 一律为 `false`（adapter-codex.md §7），沙箱里的命令连不上任何网络。需要联网的命令会以审批形式交给人。
- ACP Agent 没有 Hub 能强制的沙箱，这一层对它们不存在（见 §3.6）。

### 3.4 第四层：Hub 自己的推送

Hub 唯一的推送是网页 Agent 的任务分支，规则见 [web-agent.md](web-agent.md) §3.1：远端名白名单 + **按改写后的最终 URL** 校验主机白名单与 GitHub 黑名单 + 只允许 `agent-hub/*` + 禁止强推 + `GIT_ALLOW_PROTOCOL` 限定为该 URL 的协议 + 审计。

`git remote get-url --push` 的输出可能带凭据（实测：用户的 `insteadOf` 规则会把地址改写成 `https://x-access-token:<token>@github.com/...`）。所有 URL 在写日志、写审计、返回界面之前必须先去掉 userinfo（`scheme://user:pass@host` → `scheme://host`）。

### 3.5 第五层：事后检测

- 每轮开始前和结束后，记录仓库 `refs/remotes/*` 下所有远端跟踪分支的值。推送到**命名远端**（`git push origin ...`）成功时 git 会更新对应的远端跟踪分支，所以轮结束后若 `refs/remotes/origin/*` 有变化而 Hub 没有执行过 fetch，就记 `security.alert` 审计、发 `notice`（warning）和系统通知。直接按 URL 推送不会更新远端跟踪分支（已实测），这种情况检测不到，只能依赖前几层。
- 同时扫描该轮的命令执行事件（`tool.started` 且 `toolKind: 'command'`），`command` 里出现 `git push`、`gh `、`GIT_ALLOW_PROTOCOL` 时同样告警。Agent 不一定报告完整命令，这只是辅助手段。
- 仓库注册时体检：`origin` 的 push URL 是否已禁用。没禁用时设置页给出建议命令 `git remote set-url --push origin DISABLED`，**由用户确认后**才由 Hub 执行（Hub 不擅自改用户的 git 配置）。

### 3.6 残余风险

- ACP Agent 可以在自己的命令里清掉环境变量（如 `env -u GIT_ALLOW_PROTOCOL git push`）。这时还剩：子进程里没有 SSH agent、没有 GitHub token、`gh` 未登录；`origin` 的 push URL 已禁用（若用户采纳了 §3.5 的建议）；事后检测。对策是：ACP 任务默认只读、可写任务里 Agent 的命令执行一般会触发权限请求（取决于 Agent 的模式），由人把关；风险写进 [risks-and-open-questions.md](risks-and-open-questions.md) R7。
- 用户在 Hub 之外自己执行的 git 操作不在保护范围内。

## 4. 凭据与身份

### 4.1 Hub 不碰 Agent 的凭据

- 不读取 `~/.codex/auth.json`、Qoder 的凭据文件，不调用任何登录、登出接口。Agent 用自己的存储完成鉴权。
- 未登录时只给提示（“在终端运行 `codex login`”），不代办。

### 4.2 子进程环境变量白名单

子进程的环境变量**按白名单构造**，而不是从侧车环境里删黑名单，这样以后新出现的密钥变量默认不会被继承：

- 保留：`PATH`（登录 shell 解析的结果）、`HOME`、`USER`、`LOGNAME`、`SHELL`、`LANG`、`LC_*`、`TERM`、`TMPDIR`、`TZ`；
- 加上 profile 的 `envPassthrough`（例如某个 Agent 需要自己的配置目录变量）；
- 加上 §3.1 的 git 守卫变量；
- 其余一律不传，尤其是 `SSH_AUTH_SOCK`、各种 `*_TOKEN`、`*_KEY`、`*_SECRET`、`AWS_*`、`NPM_TOKEN`。

`HOME` 必须保留（Agent 要读自己的登录状态），所以子进程仍能读到用户的全局 git 配置和钥匙串里的 git 凭据助手——但 §3.1 已经在协议层挡住了所有网络传输。

### 4.3 桥接方的权限边界

- 默认 token 的 scope 见 [local-api.md](local-api.md) §1.3：**不能审批**，不能操作别人的任务。
- 桥接方创建的写任务默认要人在界面上确认（`security.bridgeWriteRequiresConfirmation: true`），确认与拒绝都写审计。
- `cwd` 只能落在已注册仓库之内（`PATH_NOT_ALLOWED`），桥接方不能让 Agent 去 `~/.ssh` 之类的目录。
- 每个 token 限流；token 可在设置页随时吊销，吊销后正在连接的 WebSocket 以 `4401` 断开。

### 4.4 Hub 自己的 token

- UI token：每次启动随机生成，只在内存里（Tauri 进程、侧车进程、Hub UI），不写盘、不进环境变量。
- 桥接 token：库里只存 SHA-256；默认 token 的明文只写 `bridge-token` 文件（`0600`），供同一用户下的本地郎读取；设置页新建的 token 明文只显示一次。
- **任何 token 都不传给 Agent 子进程。**

### 4.5 其他密钥

M1–M5 Hub 不需要保存任何第三方密钥。若网页 Agent 采用官方 API（web-agent.md 方案 A）需要个人 token，存 macOS 钥匙串（用系统自带的 `security` 命令读写，服务名 `com.multiapps.agenthub`，账户名为驱动 id），不写配置文件。

## 5. 脱敏

统一的 `redact(text)` 用在：日志、transcript、诊断包、返回给桥接方的所有文本（消息、工具输出、diff）。规则（单测逐条覆盖）：

| 模式                                          | 示例                                       |
| --------------------------------------------- | ------------------------------------------ |
| Hub token                                     | `ahb_` + 43 位 base64url                   |
| `Authorization: Bearer …`、`x-access-token:…` | HTTP 头、git URL                           |
| URL 中的 userinfo                             | `https://user:pass@host/...`               |
| GitHub token                                  | `ghp_`、`gho_`、`ghs_`、`github_pat_` 开头 |
| OpenAI 风格密钥                               | `sk-` 开头的长串                           |
| Slack token                                   | `xoxb-`、`xoxp-` 等                        |
| AWS 访问密钥                                  | `AKIA` + 16 位                             |
| JWT                                           | 三段 base64url，以 `eyJ` 开头              |
| PEM 私钥块                                    | `-----BEGIN … PRIVATE KEY-----`            |

替换为 `«已脱敏»`。Hub UI 里展示的本机 diff 不脱敏（是用户自己的代码，在本机查看）。

## 6. 本地接口

- 只绑定 `127.0.0.1`；`Host` 头与 `Origin` 头白名单；不用 Cookie，鉴权只靠 Bearer token。浏览器不会自动携带 Bearer token，网页即使猜到端口也拿不到 token，所以 CSRF 与 DNS rebinding 都无法成功调用（细则见 [local-api.md](local-api.md) §1）。
- 唯一免鉴权的接口是 `GET /healthz`，只暴露“Hub 在运行”这一事实。
- Hub 自身不发起任何外网请求：不检查更新、不上报遥测、不接 Sentry。会联网的只有 Agent 进程（连各自的服务商）、Hub 对内网 `internal` 的 git 操作、网页 Agent 的 Chrome。

## 7. 默认只读与工作区隔离

| Agent 类型 | 只读任务（默认）                                                                       | 可写任务                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Codex      | 沙箱 `read-only`，`networkAccess: false`，`approvalPolicy: on-request`                 | 独立 worktree；沙箱 `workspace-write`，`writableRoots` 只有该 worktree，`networkAccess: false`；永不使用 `danger-full-access` |
| ACP        | 切到 profile 的只读模式（若有）；不声明 `fs.writeTextFile`；工作区快照比对，越界即告警 | 独立 worktree；`fs/write_text_file` 只允许写 worktree 之内且不能写 `.git/`；禁止切到 `bypassPermissions` 一类模式             |
| 网页 Agent | 不适用（代码在云端）                                                                   | 只经内网任务分支交换代码                                                                                                      |

- 任务没写 `mode` 时一律 `read_only`。
- 可写任务默认用 worktree；选 `in_place` 要在界面上显式勾选并二次确认。

## 8. 桌面壳与 WebView

细节见 [desktop-shell.md](desktop-shell.md) §3、§6，要点：

- capability 只按 webview label 授给 `hub`，不写 `windows`；Bot 子 WebView 没有任何 IPC。
- 不对 Bot 页面注入脚本；导航与新窗口白名单；独立数据存储。
- Hub UI 有严格 CSP，只加载本地资源。
- IPC 命令的参数都做校验：`reveal_path` 只允许已注册仓库与 worktree 目录，`open_external` 只允许 `http` / `https`。

## 9. 数据流出

需要 owner 知情并决策（待决问题 Q6）：

1. 发给各 Agent 的提示词和它们读到的代码，会到达对应服务商（Codex → OpenAI，Qoder → 其服务端，AoneD → 公司内网）。这是使用这些 Agent 的前提，Hub 不增加新的流出。
2. **本地郎取走的结果和 diff，会进入它背后大模型的上下文。** 如果本地郎由外部大模型驱动，公司代码会随之流出到该服务商。Hub 提供的控制：桥接 token 可以不带 `diff:read`；`security.bridgeSummaryOnly` 只给摘要（[local-api.md](local-api.md) §2）；`security.maxBridgeDiffBytes` 限制大小；返回内容统一脱敏；所有读取写访问日志（按 token 统计）。

## 10. 安全验收清单

每个里程碑的 PR 都要在 owner 的 Mac 上逐项勾选，结果贴进 PR：

- [ ] `lsof -nP -iTCP:47821 -sTCP:LISTEN` 只显示 `127.0.0.1`。
- [ ] `curl -H 'Host: evil.example' http://127.0.0.1:47821/api/v1/health` 返回 421；不带 token 返回 401；带吊销的 token 返回 401。
- [ ] 带 `Origin: https://evil.example` 的请求返回 403。
- [ ] 在 Bot 面板的开发者工具里调用 Tauri IPC 失败。
- [ ] Agent 子进程的环境（`ps eww -p <pid>`）里有 `GIT_ALLOW_PROTOCOL=file`，没有 `SSH_AUTH_SOCK`、没有任何 token。
- [ ] 可写任务里让 Agent 执行 `git push origin HEAD`：失败；审计里没有推送记录；`refs/remotes/origin/*` 没变。
- [ ] 把测试仓库 `internal` 的 URL 用 `insteadOf` 改写成指向 `github.com`，让 Hub 推任务分支：被拒绝（`GIT_PUSH_BLOCKED`），审计记录被拒。
- [ ] `grep -rE 'ahb_[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9]' "<AGENT_HUB_HOME>/logs" "<AGENT_HUB_HOME>/transcripts"` 没有结果。
- [ ] `AGENT_HUB_HOME` 权限 `700`，`bridge-token` 权限 `600`。
- [ ] 只读任务（Codex）被要求修改文件时，要么出现审批、要么被沙箱拒绝，工作区没有变化。
