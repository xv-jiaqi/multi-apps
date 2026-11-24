/** security.md §3.1：Hub 侧的推送地址检查，与 pre-push 脚本的主机规则一致。 */
import { checkPushTarget, parsePushTarget, stripUserinfo } from '../../src/workspace/push-target';

const policy = {
  allowedHosts: ['git.example'],
  blockedHosts: ['github.com', 'ssh.github.com', 'gist.github.com'],
  allowLocal: false,
};

describe('push-target', () => {
  it.each([
    ['https://git.example/team/repo.git', 'https', 'git.example'],
    ['https://user:pw@GIT.example:8443/r.git', 'https', 'git.example'],
    ['git@git.example:team/repo.git', 'ssh', 'git.example'],
    ['ssh://git@[2001:db8::1]/r.git', 'ssh', '2001:db8::1'],
    ['git@[2001:db8::1]:r.git', 'ssh', '2001:db8::1'],
    ['file:///tmp/bare.git', 'file', null],
    ['/tmp/bare.git', 'file', null],
    ['../bare.git', 'file', null],
  ])('parse %s', (url, protocol, host) => {
    expect(parsePushTarget(url)).toEqual({ protocol, host });
  });

  it.each([
    ['https://git.example/team/repo.git', null],
    ['git@git.example:team/repo.git', null],
    ['https://tok@github.com/o/r.git', 'github.com'],
    ['git@github.com:o/r.git', 'github.com'],
    ['https://foo.github.com/o/r.git', 'foo.github.com'],
    ['https://evil.git.example/o/r.git', 'evil.git.example'],
    ['ssh://git@[2001:db8::1]/r.git', '2001:db8::1'],
    ['/tmp/bare.git', '本机'],
  ])('check %s', (url, hit) => {
    const reason = checkPushTarget(url, policy);
    if (hit === null) expect(reason).toBeNull();
    else expect(reason).toContain(hit);
  });

  it('黑名单优先于白名单（子域名也算）', () => {
    expect(
      checkPushTarget('https://foo.github.com/o/r.git', {
        ...policy,
        allowedHosts: ['foo.github.com'],
      }),
    ).toContain('黑名单');
  });

  it('allowLocal 放行本机路径', () => {
    expect(checkPushTarget('/tmp/bare.git', { ...policy, allowLocal: true })).toBeNull();
  });

  it('stripUserinfo：https 去掉整段 userinfo，ssh 只去密码', () => {
    expect(stripUserinfo('https://x-access-token:abc@github.com/o/r.git')).toBe(
      'https://github.com/o/r.git',
    );
    expect(stripUserinfo('ssh://git:pw@host/r.git')).toBe('ssh://git@host/r.git');
    expect(stripUserinfo('git:pw@host:r.git')).toBe('git@host:r.git');
    expect(stripUserinfo('git@host:r.git')).toBe('git@host:r.git');
  });
});
