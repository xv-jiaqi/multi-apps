/**
 * testing.md E43：security.md §3.3 的 12 组，直接调用 ensureHooks 生成的 pre-push。
 * 白名单 git.example，黑名单为默认的 3 个 GitHub 主机。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORWARDED_HOOKS, PUSH_BLOCKED_MARKER, ensureHooks } from '../../src/workspace/hooks';

const BLOCKED = ['github.com', 'ssh.github.com', 'gist.github.com'];
const SHA = 'a'.repeat(40);
const ZERO = '0'.repeat(40);
const TOKEN = 'ghp_' + 'T'.repeat(36);

interface Case {
  n: number;
  url: string;
  /** pre-push 的 stdin：<local ref> <local sha> <remote ref> <remote sha> */
  line?: string;
  allowed?: string | null;
  result: 'allow' | 'deny';
}

const ref = (remoteRef: string, localSha = SHA) => `refs/heads/x ${localSha} ${remoteRef} ${ZERO}`;
const AH = ref('refs/heads/agent-hub/ab');

const CASES: Case[] = [
  { n: 1, url: 'https://git.example/team/repo.git', result: 'allow' },
  { n: 2, url: 'git@git.example:team/repo.git', result: 'allow' },
  { n: 3, url: `https://x-access-token:${TOKEN}@github.com/o/r.git`, result: 'deny' },
  { n: 4, url: 'git@github.com:o/r.git', result: 'deny' },
  { n: 5, url: 'ssh://git@[2001:db8::1]/r.git', result: 'deny' },
  { n: 6, url: '/tmp/bare.git', result: 'deny' },
  {
    n: 7,
    url: 'https://git.example/team/repo.git',
    line: `(delete) ${ZERO} refs/heads/agent-hub/ab ${SHA}`,
    result: 'deny',
  },
  { n: 8, url: 'https://git.example/team/repo.git', line: ref('refs/tags/v1'), result: 'deny' },
  {
    n: 9,
    url: 'https://foo.github.com/o/r.git',
    allowed: 'git.example,foo.github.com',
    result: 'deny',
  },
  { n: 10, url: 'https://evil.git.example/o/r.git', result: 'deny' },
  { n: 11, url: 'https://git.example/team/repo.git', line: ref('refs/heads/main'), result: 'deny' },
  { n: 12, url: 'https://git.example/team/repo.git', allowed: null, result: 'deny' },
];

describe('E43 pre-push（security.md §3.3 的 12 组）', () => {
  let dir: string;
  let hooks: string;
  let log: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ah-prepush-'));
    hooks = join(dir, 'hooks');
    log = join(dir, 'guard', 'blocked.ndjson');
    ensureHooks(hooks, BLOCKED, log);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (c: Case) => {
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
    const allowed = c.allowed === undefined ? 'git.example' : c.allowed;
    if (allowed !== null) env.AGENT_HUB_PUSH_ALLOWED_HOSTS = allowed;
    return spawnSync(join(hooks, 'pre-push'), ['origin', c.url], {
      input: `${c.line ?? AH}\n`,
      env,
      encoding: 'utf8',
    });
  };

  it.each(CASES)('#$n $url → $result', (c) => {
    const before = readLog(log).length;
    const r = run(c);
    if (c.result === 'allow') {
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(readLog(log).length).toBe(before);
    } else {
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain(PUSH_BLOCKED_MARKER);
      const lines = readLog(log);
      expect(lines.length).toBe(before + 1);
      const entry = JSON.parse(lines.at(-1)!) as { remote: string; url: string; reason: string };
      expect(entry.remote).toBe('origin');
      expect(entry.reason).not.toBe('');
    }
  });

  it('#3 日志里的 URL 没有 token', () => {
    const text = readFileSync(log, 'utf8');
    expect(text).toContain('https://github.com/o/r.git');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('x-access-token');
  });

  it('本机路径：设 AGENT_HUB_PUSH_ALLOW_LOCAL=1 才放行', () => {
    const r = spawnSync(join(hooks, 'pre-push'), ['origin', '/tmp/bare.git'], {
      input: `${AH}\n`,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        AGENT_HUB_PUSH_ALLOWED_HOSTS: 'git.example',
        AGENT_HUB_PUSH_ALLOW_LOCAL: '1',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });

  it('hooks 目录：pre-push 与 13 个转发脚本，权限 0755；不含 reference-transaction', () => {
    expect(FORWARDED_HOOKS).toHaveLength(13);
    expect(FORWARDED_HOOKS).not.toContain('pre-push');
    expect(FORWARDED_HOOKS).not.toContain('reference-transaction');
    for (const name of ['pre-push', ...FORWARDED_HOOKS]) {
      expect(statSync(join(hooks, name)).mode & 0o777).toBe(0o755);
    }
    expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).not.toContain('exec "$orig');
  });

  it('非法的黑名单主机直接抛错，不写进脚本', () => {
    expect(() => ensureHooks(join(dir, 'bad'), ["evil.com'; rm -rf /"], log)).toThrow();
  });
});

function readLog(file: string): string[] {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
