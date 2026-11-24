/* eslint-disable no-console -- 证据脚本，结果直接打印成 Markdown 表 */
// 用真实 codex-cli 0.164.0 验证 shell_environment_policy 会不会剥掉守卫变量，以及 thread/start 的 config 覆盖能否救回。
// 不需要登录：thread/shellCommand 在本机直接跑命令。
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CODEX = process.env.CODEX_BIN ?? 'codex';
const GUARD = {
  GIT_ALLOW_PROTOCOL: 'file',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '/hub/guard/askpass.sh',
  SSH_ASKPASS: '/hub/guard/askpass.sh',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/hub/guard/hooks',
  GH_CONFIG_DIR: '/hub/guard/gh',
};
const set = Object.fromEntries(
  Object.entries(GUARD).map(([k, v]) => [`shell_environment_policy.set.${k}`, v]),
);
const OVERRIDES = {
  none: null,
  'set only': set,
  'set + include_only=[]（Hub 的做法）': { 'shell_environment_policy.include_only': [], ...set },
};
const POLICIES = {
  '（不设）': '',
  'inherit = "none"': '[shell_environment_policy]\ninherit = "none"\n',
  'include_only = ["PATH","HOME"]': '[shell_environment_policy]\ninclude_only = ["PATH", "HOME"]\n',
  'exclude = ["GIT_*","GH_*","SSH_*"]':
    '[shell_environment_policy]\nexclude = ["GIT_*", "GH_*", "SSH_*"]\n',
  'inherit = "core"': '[shell_environment_policy]\ninherit = "core"\n',
};
const CMD =
  'echo "GAP=${GIT_ALLOW_PROTOCOL:-unset} GCC=${GIT_CONFIG_COUNT:-unset} HOOKS=${GIT_CONFIG_VALUE_0:-unset} ASKPASS=${GIT_ASKPASS:-unset}"';

function run(policy, config) {
  return new Promise((resolve) => {
    const home = mkdtempSync(join(tmpdir(), 'cxenv-'));
    writeFileSync(join(home, 'config.toml'), policy);
    const cwd = mkdtempSync(join(tmpdir(), 'cxenv-cwd-'));
    const child = spawn(CODEX, ['app-server'], {
      cwd,
      env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, ...GUARD },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let out = '';
    let id = 0;
    const pending = new Map();
    const send = (method, params) =>
      new Promise((res) => {
        const i = ++id;
        pending.set(i, res);
        child.stdin.write(JSON.stringify({ id: i, method, params }) + '\n');
      });
    const done = (v) => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(v);
    };
    const timer = setTimeout(() => done(`timeout; out=${out}`), 30000);
    child.stdout.on('data', (d) => {
      buf += d;
      let n;
      while ((n = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, n);
        buf = buf.slice(n + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id !== undefined && pending.has(m.id)) {
          pending.get(m.id)(m);
          pending.delete(m.id);
          continue;
        }
        if (m.method === 'item/commandExecution/outputDelta') out += m.params.delta ?? '';
        if (m.method === 'item/completed' && m.params?.item?.type === 'commandExecution')
          done((m.params.item.aggregatedOutput ?? out).trim());
      }
    });
    (async () => {
      await send('initialize', {
        clientInfo: { name: 'agent_hub', title: 'Agent Hub', version: '0' },
        capabilities: { experimentalApi: false },
      });
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      const st = await send('thread/start', {
        cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ...(config ? { config } : {}),
      });
      if (st.error) return done(`thread/start error ${JSON.stringify(st.error)}`);
      const r = await send('thread/shellCommand', { threadId: st.result.thread.id, command: CMD });
      if (r.error) return done(`shellCommand error ${JSON.stringify(r.error)}`);
    })();
  });
}

console.log(`codex: ${CODEX}\n命令: ${CMD}\n`);
console.log(
  '| config.toml 的 shell_environment_policy | thread/start 的 config | 命令看到的守卫变量 |',
);
console.log('| --- | --- | --- |');
for (const [pn, policy] of Object.entries(POLICIES)) {
  for (const [on, config] of Object.entries(OVERRIDES)) {
    console.log(`| ${pn} | ${on} | ${await run(policy, config)} |`);
  }
}
