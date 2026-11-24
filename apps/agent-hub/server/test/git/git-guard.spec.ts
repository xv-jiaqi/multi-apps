/**
 * security.md §3.1–§3.3：GitGuard 生成的守卫目录与 Agent 子进程环境，用真 git 验证。
 * 另测 testing.md E43 的 commit-msg 转发（仓库自己的 hook 仍会跑，pre-push 不转发）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePaths, type HubPaths } from '../../src/common/paths';
import { GitGuard } from '../../src/workspace/git-guard';
import { PUSH_BLOCKED_MARKER } from '../../src/workspace/hooks';

const BLOCKED = ['github.com', 'ssh.github.com', 'gist.github.com'];

describe('GitGuard（真 git）', () => {
  let root: string;
  let paths: HubPaths;
  let guard: GitGuard;
  let repo: string;
  let bare: string;
  let env: Record<string, string>;

  const parentEnv: NodeJS.ProcessEnv = {
    HOME: '/tmp/ah-home-placeholder',
    USER: 'u',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: process.env.PATH,
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    GH_TOKEN: 'secret-gh',
    GITHUB_TOKEN: 'secret-github',
    OPENAI_API_KEY: 'secret-openai',
    AWS_SECRET_ACCESS_KEY: 'secret-aws',
    FAKE_SCENARIO: '/x.json',
    GIT_DIR: '/should/not/leak',
  };

  const git = (cwd: string, args: string[], extra: Record<string, string> = env) =>
    spawnSync('git', ['-C', cwd, ...args], {
      env: {
        ...extra,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.invalid',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.invalid',
      },
      encoding: 'utf8',
      timeout: 20_000,
    });

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ah-guard-'));
    paths = resolvePaths({ AGENT_HUB_HOME: join(root, 'home') });
    guard = new GitGuard(paths, parentEnv);
    guard.ensure({ blockedPushHosts: BLOCKED, loginPath: process.env.PATH ?? '/usr/bin:/bin' });
    env = { ...guard.agentEnv(['FAKE_SCENARIO', 'bad-name', 'NOT_SET']), HOME: root };

    bare = join(root, 'bare.git');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    expect(git(repo, ['add', '-A']).status).toBe(0);
    expect(git(repo, ['commit', '-q', '-m', 'init']).status).toBe(0);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'local', bare]);
    execFileSync('git', ['-C', repo, 'remote', 'add', 'gh', 'https://github.com/o/r.git']);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('ensure：askpass 恒失败、hooks 0755、guard 目录 0700', () => {
    expect(statSync(paths.guard).mode & 0o777).toBe(0o700);
    expect(statSync(paths.ghConfig).mode & 0o777).toBe(0o700);
    expect(statSync(paths.askpass).mode & 0o777).toBe(0o755);
    expect(spawnSync(paths.askpass).status).toBe(1);
    expect(statSync(join(paths.hooks, 'pre-push')).mode & 0o777).toBe(0o755);
    expect(guard.blockedCount()).toBe(0);
  });

  it('agentEnv：白名单 + 守卫变量，不带凭据', () => {
    expect(env.GIT_ALLOW_PROTOCOL).toBe('file');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_ASKPASS).toBe(paths.askpass);
    expect(env.SSH_ASKPASS).toBe(paths.askpass);
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('core.hooksPath');
    expect(env.GIT_CONFIG_VALUE_0).toBe(paths.hooks);
    expect(env.GH_CONFIG_DIR).toBe(paths.ghConfig);
    expect(env.LC_ALL).toBe('C.UTF-8');
    expect(env.FAKE_SCENARIO).toBe('/x.json'); // envPassthrough
    for (const key of [
      'SSH_AUTH_SOCK',
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'OPENAI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'GIT_DIR',
      'bad-name',
      'NOT_SET',
      'AGENT_HUB_PUSH_ALLOWED_HOSTS',
    ]) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it('推本机裸仓库：pre-push 拦下（没有 AGENT_HUB_PUSH_ALLOWED_HOSTS），记 blocked 日志', () => {
    const before = guard.blockedCount();
    const r = git(repo, ['push', 'local', 'HEAD:refs/heads/agent-hub/ab']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(PUSH_BLOCKED_MARKER);
    expect(guard.blockedCount()).toBe(before + 1);
    expect(execFileSync('git', ['-C', bare, 'for-each-ref'], { encoding: 'utf8' })).toBe('');
  });

  it('仓库自己设 core.hooksPath 也盖不掉环境变量里的值', () => {
    const own = join(root, 'own-hooks');
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, 'pre-push'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(own, 'pre-push'), 0o755);
    execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', own]);
    try {
      const r = git(repo, ['push', 'local', 'HEAD:refs/heads/agent-hub/ab']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(PUSH_BLOCKED_MARKER);
    } finally {
      execFileSync('git', ['-C', repo, 'config', '--unset', 'core.hooksPath']);
    }
  });

  it('推 https / ssh：GIT_ALLOW_PROTOCOL=file 让 git 不建立连接', () => {
    for (const url of ['https://github.com/o/r.git', 'ssh://git@github.com/o/r.git']) {
      const r = git(repo, ['push', url, 'HEAD:refs/heads/agent-hub/ab']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/transport '(https|ssh)' not allowed/);
    }
    const viaConfig = git(repo, [
      '-c',
      'protocol.https.allow=always',
      'push',
      'gh',
      'HEAD:refs/heads/agent-hub/ab',
    ]);
    expect(viaConfig.status).not.toBe(0);
    expect(viaConfig.stderr).toMatch(/not allowed/);
  });

  it('不带守卫环境时同一推送会成功（对照组，证明上面的拦截来自守卫）', () => {
    const r = git(repo, ['push', 'local', 'HEAD:refs/heads/agent-hub/ab'], {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: root,
    });
    expect(r.status).toBe(0);
  });

  it('commit-msg 转发到仓库自己的 hook；仓库的 pre-push 不被调用', () => {
    const marker = join(root, 'commit-msg-ran');
    const own = join(repo, '.git', 'hooks');
    writeFileSync(join(own, 'commit-msg'), `#!/bin/sh\necho ran > ${marker}\nexit 0\n`);
    chmodSync(join(own, 'commit-msg'), 0o755);
    const prePushMarker = join(root, 'repo-pre-push-ran');
    writeFileSync(join(own, 'pre-push'), `#!/bin/sh\necho ran > ${prePushMarker}\nexit 0\n`);
    chmodSync(join(own, 'pre-push'), 0o755);
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    expect(git(repo, ['add', '-A']).status).toBe(0);
    expect(git(repo, ['commit', '-q', '-m', 'b']).status).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe('ran\n');
    git(repo, ['push', 'local', 'HEAD:refs/heads/agent-hub/cd']);
    expect(() => readFileSync(prePushMarker)).toThrow();
  });

  it('仓库的 commit-msg 拒绝时提交失败（commitlint 照样生效）', () => {
    const own = join(repo, '.git', 'hooks');
    writeFileSync(join(own, 'commit-msg'), '#!/bin/sh\necho nope >&2\nexit 1\n');
    chmodSync(join(own, 'commit-msg'), 0o755);
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    expect(git(repo, ['add', '-A']).status).toBe(0);
    const r = git(repo, ['commit', '-q', '-m', 'c']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('nope');
  });
});
