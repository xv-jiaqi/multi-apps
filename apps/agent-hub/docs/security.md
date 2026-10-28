# 安全设计

> 上级文档：[../README.md](../README.md)。硬性要求：只在公司 Mac 本机运行；**绝不向 GitHub 推送**；凭据不外泄；默认只读；API 只监听 localhost 并鉴权。决策见 [decisions-and-risks.md](decisions-and-risks.md) D44–D52、D61。下面 `push-target.ts`、`agent-env.ts`、`hooks.ts`、`redact.ts` 的全文在临时目录用 TypeScript 6 `tsc --strict --noEmit` 通过，并用 Node 22 跑过文中列出的用例。

## 1. 资产

| 资产                | 在哪里                                                 |
| ------------------- | ------------------------------------------------------ |
| 公司源代码          | 本地仓库、worktree、diff 补丁、按需打开的 transcript   |
| 各 Agent 的登录凭据 | `~/.codex`、Qoder 等 CLI 自己的存储（Hub 不读，D60）   |
| git 凭据            | 用户的 git 凭据助手、SSH agent（不传给 Agent 子进程）  |
| 本地郎对话的登录态  | Bot 子 WebView 的独立数据存储                          |
| Hub 自己的 token    | 内存里的 UI token；`bridge-token` 文件与库里的 SHA-256 |

## 2. 威胁模型

| 编号 | 威胁                     | 场景                                                                                 | 控制                            |
| ---- | ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------- |
| T1   | 代码被推到 GitHub        | Agent 执行 `git push`；提示词注入；Hub 推错主机；`insteadOf` 把内网地址改写成 GitHub | §3                              |
| T2   | 本机其他网页调用 Hub API | 恶意页面猜端口；DNS rebinding                                                        | §7                              |
| T3   | 本机其他进程调用 Hub API | 同用户的程序直接请求 `127.0.0.1:47821`                                               | §4                              |
| T4   | 凭据泄露给 Agent 或日志  | 子进程继承 `GITHUB_TOKEN`、`SSH_AUTH_SOCK`；日志和桥接响应里出现 token               | §4、§5、§6                      |
| T5   | Agent 越权改动           | 只读任务改了文件；可写任务改到工作区以外                                             | §7                              |
| T6   | Bot 页面拿到本机能力     | 本地郎页面或被注入的脚本调用 Tauri IPC                                               | §9                              |
| T7   | 桥接方权限过大           | 本地郎自动批准命令，或指定仓库以外的目录                                             | §4.3                            |
| T8   | 代码随结果流出           | 本地郎把 diff 和输出带进背后的模型上下文                                             | §4.3、§6                        |
| T9   | 网页任务被劫持           | 人把会话链接交给别人；Hub 自己不打开浏览器调试端口                                   | [web-agent.md](web-agent.md) §5 |

## 3. 绝不向 GitHub 推送

任何一层单独失效都不应让一次 GitHub 推送成功。Agent 子进程还有 `GIT_ALLOW_PROTOCOL=file`（§3.2）；Hub 自己的推送不设这个变量，改由本节的主机检查和 §3.3 的 `pre-push` 把关。

### 3.1 Agent 子进程的 git 环境与推送地址

两件事放在一起，因为推送地址在环境变量改写之后才确定：

1. **禁用 `origin` 的推送地址**（D49）。注册仓库时“禁用 origin 的推送”默认勾选，用户点保存后 Hub 执行 `git remote set-url --push origin DISABLED`。没禁用时，设置页仓库分区仍显示这条建议。网页任务不依赖 origin 已禁用，但体检照样建议。
2. **`allowedPushHosts` 不手填。** 保存设置时对每个仓库执行 `git remote get-url --push <internalRemote>`（这是 `insteadOf` / `pushInsteadOf` 之后的地址），用 `parsePushTarget` 取主机名。主机命中 `security.blockedPushHosts`（默认 `github.com`、`ssh.github.com`、`gist.github.com`，子域名也算）→ `400 REPO_INVALID`；协议是 `ssh` / `https` → 写入 `[主机名]`；没有该远端、本机路径、其他协议 → `[]`，仓库体检报问题，网页任务在准备时失败（[web-agent.md](web-agent.md) §3.1）。

`checkPushTarget(url, policy)` 返回 `null` 表示允许，否则是中文拒绝原因。`PushPolicy` 为 `{ allowedHosts, blockedHosts, allowLocal }`。黑名单含子域名，且优先于白名单；白名单只做整主机匹配（`evil.git.example` 不等于 `git.example`）。`allowLocal` 只在测试里为 `true`。`stripUserinfo`：https 去掉整个 userinfo，ssh 只去掉密码。

不用 `url.<base>.insteadOf` 去改写 GitHub 地址。设计时在 git 2.43 上见过：全局已有一条同长度的 `https://github.com/` 改写时，注入的规则不生效；`pushInsteadOf` 对显式 `pushurl` 不生效。`GIT_ALLOW_PROTOCOL=file` 则在改写之后、连接之前拒绝 `https` / `ssh` / `git`，本地 `status`、`commit`、`worktree` 不受影响。

```ts
// server/src/workspace/push-target.ts
export interface PushPolicy {
  allowedHosts: readonly string[];
  blockedHosts: readonly string[];
  allowLocal: boolean;
}

export interface PushTarget {
  protocol: string;
  host: string | null;
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

/** 支持 https、ssh、scp 写法（含 IPv6）和本机路径。host 为小写，本机路径的 host 为 null。 */
export function parsePushTarget(url: string): PushTarget {
  const raw = url.trim();
  const scheme = SCHEME.exec(raw);
  if (scheme) {
    const protocol = scheme[1]!.toLowerCase();
    if (protocol === 'file') return { protocol, host: null };
    const rest = raw.slice(scheme[0].length);
    const slash = rest.indexOf('/');
    const auth = slash === -1 ? rest : rest.slice(0, slash);
    const at = auth.lastIndexOf('@');
    const afterAuth = at === -1 ? rest : rest.slice(at + 1);
    if (afterAuth.startsWith('[')) {
      const end = afterAuth.indexOf(']');
      const host = end === -1 ? '' : afterAuth.slice(1, end);
      return { protocol, host: host === '' ? null : host.toLowerCase() };
    }
    const hostport = (slash === -1 ? afterAuth : afterAuth.slice(0, afterAuth.indexOf('/'))).split(
      ':',
    )[0];
    return {
      protocol,
      host: hostport === '' || hostport === undefined ? null : hostport.toLowerCase(),
    };
  }
  if (
    raw.startsWith('/') ||
    raw.startsWith('~/') ||
    raw.startsWith('./') ||
    raw.startsWith('../')
  ) {
    return { protocol: 'file', host: null };
  }
  const ipv6 = /^[^@\s]+@\[([^\]]+)\]:/.exec(raw);
  if (ipv6) return { protocol: 'ssh', host: ipv6[1]!.toLowerCase() };
  const scp = /^[^@\s]+@([^:\s]+):/.exec(raw);
  if (scp) return { protocol: 'ssh', host: scp[1]!.toLowerCase() };
  return { protocol: 'file', host: null };
}

function blocked(host: string, list: readonly string[]): boolean {
  for (const item of list) {
    const name = item.toLowerCase();
    if (host === name || host.endsWith(`.${name}`)) return true;
  }
  return false;
}

/** null = 允许。黑名单（含子域名）优先于白名单；白名单只做整主机匹配。 */
export function checkPushTarget(url: string, policy: PushPolicy): string | null {
  const target = parsePushTarget(url);
  if (target.host === null) {
    return policy.allowLocal ? null : '没有主机名，拒绝推送到本机路径';
  }
  if (blocked(target.host, policy.blockedHosts)) return `主机 ${target.host} 在推送黑名单里`;
  const allowed = new Set(policy.allowedHosts.map((host) => host.toLowerCase()));
  if (!allowed.has(target.host)) return `主机 ${target.host} 不在允许的推送主机里`;
  return null;
}

/** https 去掉整个 userinfo；ssh 只去掉密码，保留用户名。 */
export function stripUserinfo(url: string): string {
  const raw = url.trim();
  const scheme = SCHEME.exec(raw);
  if (scheme) {
    const protocol = scheme[1]!.toLowerCase();
    const rest = raw.slice(scheme[0].length);
    const slash = rest.indexOf('/');
    const auth = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? '' : rest.slice(slash);
    const at = auth.lastIndexOf('@');
    if (at === -1) return raw;
    const userinfo = auth.slice(0, at);
    const host = auth.slice(at + 1);
    if (protocol === 'http' || protocol === 'https') return `${scheme[1]}://${host}${path}`;
    const colon = userinfo.indexOf(':');
    if (colon === -1) return raw;
    return `${scheme[1]}://${userinfo.slice(0, colon)}@${host}${path}`;
  }
  const withPassword = /^([^@/\s]+):([^@/\s]+)@([^:\s]+):(.+)$/.exec(raw);
  if (withPassword) return `${withPassword[1]}@${withPassword[3]}:${withPassword[4]}`;
  return raw;
}
```

### 3.2 子进程环境的构造

`deps.agentEnv()` 是 Codex、ACP、`worktreeSetup` 的唯一环境（[adapter-interface.md](adapter-interface.md) §8.4）。`PATH` 用登录 shell 解析的结果，不用侧车从 Finder 继承的那份短 PATH（[adapter-interface.md](adapter-interface.md) §8.1）。`envPassthrough` 只按配置里的变量名从父进程取值，名字必须是 `^[A-Z_][A-Z0-9_]*$`。`SSH_AUTH_SOCK` 即使被写进 passthrough 也删掉。

| 变量                                     | 值                               | 作用                        |
| ---------------------------------------- | -------------------------------- | --------------------------- |
| `GIT_ALLOW_PROTOCOL`                     | `file`                           | 拒绝 https / ssh / git 传输 |
| `GIT_TERMINAL_PROMPT`                    | `0`                              | 不弹出凭据提示              |
| `GIT_ASKPASS`、`SSH_ASKPASS`             | `paths.askpass`                  | 脚本只有 `exit 1`           |
| `GIT_CONFIG_COUNT` / `KEY_0` / `VALUE_0` | `core.hooksPath` = `paths.hooks` | 见 §3.3                     |
| `GH_CONFIG_DIR`                          | `paths.ghConfig`                 | 空目录，`gh` 未登录         |

`HOME` 必须留下，Agent 才能读到自己的登录状态，因此子进程仍能读到用户的全局 git 配置。网络传输已经被 `GIT_ALLOW_PROTOCOL` 和 §3.3 挡住。

```ts
// server/src/workspace/agent-env.ts

const BASE_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TERM', 'TMPDIR', 'TZ'] as const;

export interface AgentEnvInput {
  parent: Readonly<Record<string, string | undefined>>;
  /** 登录 shell 解析出的 PATH（adapter-interface.md §8.1）。 */
  loginPath: string;
  passthrough: readonly string[];
  hooksPath: string;
  askpassPath: string;
  ghConfigDir: string;
}

/** 按白名单构造 Agent 子进程环境，再盖上 git 守卫变量。不从父进程继承其余变量。 */
export function agentEnv(input: AgentEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of BASE_KEYS) {
    const value = input.parent[key];
    if (value) env[key] = value;
  }
  for (const [key, value] of Object.entries(input.parent)) {
    if (key.startsWith('LC_') && value) env[key] = value;
  }
  env.PATH = input.loginPath;
  for (const name of input.passthrough) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) continue;
    const value = input.parent[name];
    if (value !== undefined) env[name] = value;
  }
  env.GIT_ALLOW_PROTOCOL = 'file';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = input.askpassPath;
  env.SSH_ASKPASS = input.askpassPath;
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
  env.GIT_CONFIG_VALUE_0 = input.hooksPath;
  env.GH_CONFIG_DIR = input.ghConfigDir;
  delete env.SSH_AUTH_SOCK;
  return env;
}
```

### 3.3 Hub 的 hooks 目录

`GitGuard.ensure()` 每次启动重写 `<AGENT_HUB_HOME>/guard/`（[data-model.md](data-model.md) §1）：

- `askpass`：`#!/bin/sh` 然后 `exit 1`，权限 0755。
- `gh/`：空目录。
- `hooks/`：下表的脚本，权限 0755。`ensureHooks` 每次整份覆盖。

`FORWARDED_HOOKS` 是 13 个转发给仓库自己的 hook，**不含** `pre-push`，也**不含** `reference-transaction`。转发脚本用 `git config --local --get core.hooksPath` 找仓库原来的目录（不受环境变量里的 `core.hooksPath` 影响），为空时用 `git rev-parse --git-common-dir` 下的 `hooks`。这样 Agent 提交时，仓库自己的 `commit-msg`（本仓库的 commitlint）仍然会跑。

`pre-push` **不**转发仓库自己的 `pre-push`（D61）。规则：

- 没有 `AGENT_HUB_PUSH_ALLOWED_HOSTS` 就拒绝。Agent 子进程没有这个变量，所以它们的推送到不了钩子放行的分支。
- 有这个变量时，主机先过黑名单（含子域名），再按逗号分隔的白名单做整主机匹配。
- 只允许 `refs/heads/agent-hub/*`。删除（本地 sha 全是 `0`）和 `refs/tags/*` 拒绝。
- 没有主机名的 URL（本机路径）默认拒绝。测试把 `allowLocalRemotes` 打开时，`PushService` 还要设 `AGENT_HUB_PUSH_ALLOW_LOCAL=1`，钩子才放行本机路径。
- 拒绝时 stdout 为空，stderr 含 `AGENT_HUB_PUSH_BLOCKED`，并往 `guard/blocked.ndjson` 追加一行。URL 先按 §3.1 去掉 userinfo，日志里不留 token。

临时目录里对生成的 `pre-push` 跑过这 12 组（白名单 `git.example`，黑名单为默认的 3 个 GitHub 主机）：

| #   | URL 或 ref                                                       | 环境                                          | 结果                             |
| --- | ---------------------------------------------------------------- | --------------------------------------------- | -------------------------------- |
| 1   | `https://git.example/team/repo.git` 推 `refs/heads/agent-hub/ab` | 白名单已设                                    | 放行                             |
| 2   | scp `git@git.example:team/repo.git`，同一 ref                    | 白名单已设                                    | 放行                             |
| 3   | `https://` 带 token 的 `github.com`                              | 白名单已设                                    | 拒绝；日志里的 URL 没有 token    |
| 4   | scp `git@github.com:o/r.git`                                     | 白名单已设                                    | 拒绝                             |
| 5   | `ssh://git@[2001:db8::1]/r.git`                                  | 白名单已设                                    | 拒绝（主机已解析，但不在白名单） |
| 6   | 本机路径 `/tmp/bare.git`                                         | 白名单已设、没有 `AGENT_HUB_PUSH_ALLOW_LOCAL` | 拒绝                             |
| 7   | 删除 `refs/heads/agent-hub/ab`（本地 sha 为 40 个 0）            | 白名单已设                                    | 拒绝                             |
| 8   | `refs/tags/v1`                                                   | 白名单已设                                    | 拒绝                             |
| 9   | `https://foo.github.com/...`（子域名，即使写进白名单）           | 白名单含该子域名                              | 拒绝，黑名单优先                 |
| 10  | `https://evil.git.example/...`                                   | 白名单只有 `git.example`                      | 拒绝，不是整主机                 |
| 11  | `refs/heads/main`                                                | 白名单已设                                    | 拒绝                             |
| 12  | 合法的 `agent-hub/*` 与 `git.example`                            | **不**设 `AGENT_HUB_PUSH_ALLOWED_HOSTS`       | 拒绝                             |

```ts
// server/src/workspace/hooks.ts
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 转发给仓库自己的 hook。不含 pre-push，也不含 reference-transaction。 */
export const FORWARDED_HOOKS = [
  'applypatch-msg',
  'commit-msg',
  'post-applypatch',
  'post-checkout',
  'post-commit',
  'post-merge',
  'post-rewrite',
  'pre-applypatch',
  'pre-auto-gc',
  'pre-commit',
  'pre-merge-commit',
  'pre-rebase',
  'prepare-commit-msg',
] as const;

export const PUSH_BLOCKED_MARKER = 'AGENT_HUB_PUSH_BLOCKED';

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function assertHost(host: string): string {
  const lower = host.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(lower)) throw new Error(`非法的推送主机：${host}`);
  return lower;
}

/**
 * pre-push 正文。没有 AGENT_HUB_PUSH_ALLOWED_HOSTS 时一律拒绝（Agent 子进程没有这个变量）。
 * 有这个变量时：黑名单含子域名，白名单整主机匹配，只许推 refs/heads/agent-hub/*，禁止删除和标签。
 * 本机路径默认拒绝；测试设 AGENT_HUB_PUSH_ALLOW_LOCAL=1 才放行。不转发仓库自己的 pre-push。
 */
export function prePushHookScript(blockedHosts: readonly string[], guardLog: string): string {
  const blocked = blockedHosts.map(assertHost).join(' ');
  return [
    '#!/bin/sh',
    '# Agent Hub pre-push. Rewritten on every start. Does not forward the repository pre-push.',
    'set -u',
    'remote_name=${1-}',
    'remote_url=${2-}',
    `guard_log=${shQuote(guardLog)}`,
    `blocked_hosts=${shQuote(blocked)}`,
    `marker=${shQuote(PUSH_BLOCKED_MARKER)}`,
    '',
    'json_escape() {',
    "  printf '%s' \"$1\" | tr '\\n\\r\"' '   '",
    '}',
    '',
    "safe_url=$(printf '%s' \"$remote_url\" | sed -E -e 's#^(https?://)[^@/]+@#\\1#' -e 's#^(ssh://[^:/@]+):[^@/]+@#\\1@#')",
    '',
    'deny() {',
    '  reason=$1',
    '  mkdir -p "$(dirname "$guard_log")"',
    '  printf \'%s\\n\' "{\\"remote\\":\\"$(json_escape "$remote_name")\\",\\"url\\":\\"$(json_escape "$safe_url")\\",\\"reason\\":\\"$(json_escape "$reason")\\"}" >> "$guard_log"',
    '  printf \'%s %s\\n\' "$marker" "$reason" >&2',
    '  exit 1',
    '}',
    '',
    'parse_host() {',
    '  url=$1',
    '  case $url in',
    '    file://*)',
    "      printf ''",
    '      return',
    '      ;;',
    '    *://*)',
    '      rest=${url#*://}',
    '      ;;',
    '    /*|~/*|./*|../*)',
    "      printf ''",
    '      return',
    '      ;;',
    '    *@\\[*\\]:*)',
    '      rest=${url#*@}',
    '      rest=${rest#[}',
    '      host=${rest%%]*}',
    "      printf '%s' \"$host\" | tr '[:upper:]' '[:lower:]'",
    '      return',
    '      ;;',
    '    *@*:*)',
    '      rest=${url#*@}',
    '      host=${rest%%:*}',
    "      printf '%s' \"$host\" | tr '[:upper:]' '[:lower:]'",
    '      return',
    '      ;;',
    '    *)',
    "      printf ''",
    '      return',
    '      ;;',
    '  esac',
    '  case $rest in',
    '    *@*) rest=${rest#*@} ;;',
    '  esac',
    '  case $rest in',
    '    \\[*)',
    '      rest=${rest#[}',
    '      host=${rest%%]*}',
    '      ;;',
    '    *)',
    '      host=${rest%%/*}',
    '      host=${host%%:*}',
    '      ;;',
    '  esac',
    "  printf '%s' \"$host\" | tr '[:upper:]' '[:lower:]'",
    '}',
    '',
    'allowed=${AGENT_HUB_PUSH_ALLOWED_HOSTS-}',
    'if [ -z "$allowed" ]; then',
    '  deny "缺少 AGENT_HUB_PUSH_ALLOWED_HOSTS"',
    'fi',
    "allowed=$(printf '%s' \"$allowed\" | tr '[:upper:]' '[:lower:]')",
    'host=$(parse_host "$remote_url")',
    'if [ -z "$host" ]; then',
    '  if [ "${AGENT_HUB_PUSH_ALLOW_LOCAL-}" = "1" ]; then',
    "    host='__local__'",
    '  else',
    '    deny "没有主机名，拒绝推送到本机路径"',
    '  fi',
    'fi',
    'if [ "$host" != "__local__" ]; then',
    '  blocked_hit=0',
    '  for b in $blocked_hosts; do',
    '    case $host in',
    '      "$b"|*."$b") blocked_hit=1 ;;',
    '    esac',
    '  done',
    '  if [ "$blocked_hit" -eq 1 ]; then',
    '    deny "主机 $host 在推送黑名单里"',
    '  fi',
    '  ok=0',
    '  old_ifs=$IFS',
    "  IFS=','",
    '  for a in $allowed; do',
    '    if [ "$host" = "$a" ]; then',
    '      ok=1',
    '    fi',
    '  done',
    '  IFS=$old_ifs',
    '  if [ "$ok" -eq 0 ]; then',
    '    deny "主机 $host 不在允许的推送主机里"',
    '  fi',
    'fi',
    'saw=0',
    "while IFS=' ' read -r local_ref local_sha remote_ref remote_sha; do",
    '  if [ -z "$local_ref" ]; then',
    '    continue',
    '  fi',
    '  saw=1',
    '  case $local_sha in',
    '    *[!0]*) ;;',
    '    *) deny "禁止删除远端分支" ;;',
    '  esac',
    '  case $remote_ref in',
    '    refs/tags/*) deny "禁止推送标签" ;;',
    '    refs/heads/agent-hub/*) ;;',
    '    *) deny "只允许推送 refs/heads/agent-hub/*" ;;',
    '  esac',
    'done',
    'if [ "$saw" -eq 0 ]; then',
    '  deny "没有要检查的 ref"',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

export function forwardHookScript(): string {
  return [
    '#!/bin/sh',
    '# Forward to the repository hook of the same name. core.hooksPath from the environment is ignored.',
    'hook_name=$(basename "$0")',
    'orig=$(git config --local --get core.hooksPath 2>/dev/null || true)',
    'if [ -z "$orig" ]; then',
    '  orig="$(git rev-parse --git-common-dir)/hooks"',
    'fi',
    'case $orig in',
    '  /*) ;;',
    '  *) orig="$(git rev-parse --show-toplevel)/$orig" ;;',
    'esac',
    'if [ -x "$orig/$hook_name" ]; then',
    '  exec "$orig/$hook_name" "$@"',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

/** 每次启动重写 hooks 目录。脚本权限 0755。 */
export function ensureHooks(dir: string, blockedHosts: readonly string[], guardLog: string): void {
  mkdirSync(dir, { recursive: true });
  const write = (name: string, body: string): void => {
    const file = join(dir, name);
    writeFileSync(file, body, { mode: 0o755 });
    chmodSync(file, 0o755);
  };
  write('pre-push', prePushHookScript(blockedHosts, guardLog));
  const forward = forwardHookScript();
  for (const name of FORWARDED_HOOKS) write(name, forward);
}
```

### 3.4 事后检测

本地 Agent（`codex` / `acp`）在轮前和轮后对 `refs/remotes/*` 做快照（[architecture.md](architecture.md) §5）。轮后有变化、且这期间 Hub 没有为自己的任务执行 fetch，就写审计 `security.remote_ref_changed`（[data-model.md](data-model.md) §7），并发 `notice`（`REMOTE_REF_CHANGED`，[adapter-interface.md](adapter-interface.md) §3.2）。直接按 URL 推送不会更新 `refs/remotes/*`，这一层看不到，所以不能代替 §3.1 和 §3.3。

同一时刻读取 `guard/blocked.ndjson` 里本轮新增的行，有拦截也发 `notice`。网页任务不做这层审计：Hub 没有替它执行命令的 Agent 进程，用户自己的 `git fetch` 会造成误报（[web-agent.md](web-agent.md) §4.1）。镜像 ref `refs/agent-hub/remote/<shortId>` 不在 `refs/remotes/*` 下。

### 3.5 沙箱断网与 Hub 自己的推送

- Codex 每轮 `networkAccess: false`（D30）。沙箱里的命令连不上外网；要联网就变成审批。
- ACP 没有 Hub 能强制的沙箱。这一层对它们不存在，残余风险在 §8。
- Hub 自己只推网页任务的 `refs/heads/agent-hub/<shortId>`，而且推的是 `checkPushTarget` 通过的 URL，不是远端名（[web-agent.md](web-agent.md) §2.3）。推送环境带上 `AGENT_HUB_PUSH_ALLOWED_HOSTS`（仓库的 `allowedPushHosts`，逗号分隔）。禁止强推，禁止删除远端分支。审计里的 URL 用 `stripUserinfo` 处理过。

## 4. 凭据与身份

### 4.1 Hub 不碰 Agent 的凭据

不读 `~/.codex/auth.json`，不调用 ACP 的 `authenticate` / `logout`（D60）。未登录时只显示 profile 的 `authHint`，登录由人在对应客户端或终端里完成。

### 4.2 环境变量白名单

子进程环境**按白名单构造**，不是从侧车环境里删黑名单。实现就是 §3.2 的 `agentEnv()`。保留 `PATH`（登录 PATH）、`HOME`、`USER`、`LOGNAME`、`SHELL`、`LANG`、`LC_*`、`TERM`、`TMPDIR`、`TZ`，加上 `envPassthrough`，再加上 §3.2 表格里的守卫变量。`GITHUB_TOKEN` 一类没有出现在这份名单里，就不会被继承。

### 4.3 桥接方的权限边界

- 默认 token 的 scope 是 `tasks:read` 和 `tasks:write`，**没有** `approvals:decide`（D44，[local-api.md](local-api.md) §2.3）。
- 桥接方创建的可写任务强制 `worktree`，不需要人工确认，直接排队（D45）。传入 `in_place` 得到 `403 BRIDGE_IN_PLACE_WRITE_FORBIDDEN`。
- 工作目录只能落在已注册仓库里。
- 桥接方可以读 diff，单次最多 `security.maxBridgeDiffBytes`（默认 512 KB），响应先脱敏（§6），并写 `bridge.diff_read`（D46）。
- token 可吊销；吊销后已连接的 WebSocket 以 `4401` 断开。

### 4.4 Hub 自己的 token

- UI token：每次启动随机生成，只在内存里，不写盘（D9）。
- 桥接 token：库里只存 SHA-256；默认 token 的明文只写 `bridge-token`（`0600`）。设置页新建的明文只显示一次。
- 配置文件里不放任何 token。任何 token 都不传给 Agent 子进程。

### 4.5 其他密钥

v1 不保存第三方密钥，也不把密钥放进钥匙串。以后若自动化驱动需要凭据，先在 [decisions-and-risks.md](decisions-and-risks.md) 追加决策，并且不进 `config.json`（[web-agent.md](web-agent.md) §7）。

## 5. 脱敏规则

`redact(text)` 把下表的模式换成 `«已脱敏»`。替换结果不再匹配这些模式，所以可以重复调用。单测逐条覆盖。

| 模式                               | 说明                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| Hub token                          | `ahu_` / `ahb_` 后再接 43 位 base64url                |
| `Authorization` / `x-access-token` | 头或 `key: value` 的值整段替换                        |
| URL userinfo                       | https 去掉整段；ssh 只去掉密码                        |
| GitHub token                       | `ghp_`、`gho_`、`ghu_`、`ghs_`、`ghr_`、`github_pat_` |
| OpenAI 风格密钥                    | `sk-` 后的长串                                        |
| Slack token                        | `xoxb-`、`xoxp-`、`xoxa-`、`xoxr-`、`xoxs-`           |
| AWS 访问密钥                       | `AKIA` 后 16 位大写字母或数字                         |
| JWT                                | 以 `eyJ` 开头的三段 base64url                         |
| PEM 私钥块                         | `BEGIN` / `END` 之间的 `PRIVATE KEY`                  |

```ts
// server/src/common/redact.ts
const MASK = '«已脱敏»';

/** §5 的全部模式。替换成固定占位，重复调用结果不变。 */
export function redact(text: string): string {
  let out = text;
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    MASK,
  );
  out = out.replace(/\b(?:ahu|ahb)_[A-Za-z0-9_-]{43}\b/g, MASK);
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, MASK);
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, MASK);
  out = out.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, MASK);
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, MASK);
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, MASK);
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MASK);
  out = out.replace(/\b(https?:\/\/)[^/\s@]+@/gi, '$1');
  out = out.replace(/\b(ssh:\/\/)([^:/\s@]+):[^@/\s]+@/gi, '$1$2@');
  out = out.replace(/((?:authorization|x-access-token)\s*[:=]\s*)(?:bearer\s+)?\S+/gi, `$1${MASK}`);
  return out;
}
```

## 6. 脱敏的执行点

三处调用 §5，不在界面上对 Hub UI 脱敏（那是用户自己的代码，在本机查看）：

1. **日志 meta。** 写日志前对 meta 做 `redact()`（[architecture.md](architecture.md) §11）。提示词全文不进日志，只记长度和 SHA-256 前 8 位。带 userinfo 的 git URL 先 `stripUserinfo`。
2. **桥接响应。** `BridgeRedactInterceptor` 把返回给桥接 token 的每个字符串（含 WebSocket）过一遍 `redact()`（[local-api.md](local-api.md) §3.4）。Hub UI 拿到原文。
3. **诊断包和 transcript。** 导出前再跑一遍 §5 的模式；transcript 只在诊断开关打开时写（D14）。

## 7. 本地接口与默认只读

- 只绑定 `127.0.0.1`。`Host` 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`，否则 `421 HOST_FORBIDDEN`。非法 `Origin` 为 `403 ORIGIN_NOT_ALLOWED`。不用 Cookie，鉴权只靠 Bearer token（[local-api.md](local-api.md) §2）。
- 唯一免鉴权的接口是 `GET /api/v1/health`。
- Hub 自身不发起外网请求：不检查更新、不上报遥测、不接 Sentry（D27）。会联网的只有 Agent 进程、Hub 对内网 `internal` 的 git，以及用户自己打开的网页。

| Agent 类型 | 只读任务（默认）                                             | 可写任务                                                          |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Codex      | 沙箱 `read-only`，`networkAccess: false`，审批 `on-request`  | 独立 worktree；沙箱 `workspace-write`，只把该 worktree 放进可写根 |
| ACP        | 切到 profile 的只读模式（D37）；Hub 不代写文件；轮后快照比对 | 独立 worktree；越界的 `fs/write` 由适配器拒绝                     |
| 网页       | 不适用                                                       | 只经内网任务分支交换代码（D50）                                   |

没写 `mode` 时，网页 Agent 为可写，其余为只读。界面上选择可写 + 原目录要先确认（[hub-ui.md](hub-ui.md) §5.5）。桥接方不能选原目录（D45）。

## 8. 残余风险

对应 [decisions-and-risks.md](decisions-and-risks.md) R7。

没有沙箱的 ACP Agent 可以在自己的命令里清掉 `GIT_ALLOW_PROTOCOL` 再推送。这时还剩：子进程里没有 SSH agent、没有 GitHub token、`gh` 未登录；`origin` 的推送地址在用户保持默认勾选时已被禁用（D49）；§3.4 的远端跟踪分支比对和 `blocked.ndjson`。命令执行一般会先变成审批。用户在 Hub 之外自己执行的 git 不在保护范围内。

## 9. 桌面壳与 WebView

细节在 [desktop-shell.md](desktop-shell.md) §4.6、§5.7 和 [hub-ui.md](hub-ui.md) §2.5。

- capability 只授给 label 为 `hub` 的 WebView。Bot 子 WebView 和它的弹窗匹配不到任何 capability，没有 IPC。
- 不向 Bot 页面注入脚本。导航离开白名单时用系统浏览器打开。
- opener 只放行 `http://*` 和 `https://*`（`openExternal`），以及在 Finder 里显示路径（`revealInFinder` / `opener:allow-reveal-item-in-dir`）。没有名为 `reveal_path` 或 `open_external` 的 IPC 命令。
- Hub UI 的链接守卫 `installLinkGuard` 把页面里的 http(s) 点击交给 `openExternal`，并拦住 `javascript:`。
- CSP 的 `img-src` 只有 `'self'`、`data:`、`blob:`（[desktop-shell.md](desktop-shell.md) §4.5）。Markdown 不渲染远程图片，改成链接（D63）。

## 10. 安全验收清单

在 owner 的 Mac 上逐项勾选，结果贴进 PR。自动化用例见 [testing.md](testing.md) §4 的 E41–E47。

- [ ] `lsof -nP -iTCP:47821 -sTCP:LISTEN` 只显示 `127.0.0.1`。
- [ ] `curl -H 'Host: evil.example' http://127.0.0.1:47821/api/v1/health` 返回 421；不带 token 调 `/api/v1/tasks` 返回 401；吊销的 token 返回 401。
- [ ] 带 `Origin: https://evil.example` 的请求返回 403。
- [ ] 在 Bot 面板的开发者工具里调用 Tauri `invoke` 失败。
- [ ] Agent 子进程环境里有 `GIT_ALLOW_PROTOCOL=file`，没有 `SSH_AUTH_SOCK`，没有 token。
- [ ] 可写任务里让 Agent 执行 `git push origin HEAD`：失败；`refs/remotes/origin/*` 没变。
- [ ] 把测试仓库 `internal` 的 URL 用 `insteadOf` 改写成 `github.com`，Hub 推任务分支被拒绝（`GIT_PUSH_BLOCKED`），审计 URL 不含 userinfo。
- [ ] §3.3 的 12 组 `pre-push` 结果与表一致，拦截记录里没有 token。
- [ ] 日志、transcript、诊断包里搜不到 §5 的密钥模式。
- [ ] `AGENT_HUB_HOME` 权限 `700`，`bridge-token` 权限 `600`，hooks 脚本权限 `755`。
- [ ] 只读任务改了工作区时出现提示，并且任务带上 `readOnlyViolation`。
