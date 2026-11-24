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
