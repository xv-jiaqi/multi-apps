import { redact } from './redact';

describe('E47 redact', () => {
  const MASK = '«已脱敏»';

  it('E47 Hub token ahu_/ahb_', () => {
    const tok = `ahu_${'a'.repeat(43)}`;
    expect(redact(`token=${tok}`)).toBe(`token=${MASK}`);
    const bridge = `ahb_${'b'.repeat(43)}`;
    expect(redact(bridge)).toBe(MASK);
  });

  it('E47 Authorization / x-access-token', () => {
    expect(redact('Authorization: Bearer secret-value')).toContain(MASK);
    expect(redact('x-access-token: abcdef')).toContain(MASK);
  });

  it('E47 URL userinfo', () => {
    expect(redact('https://user:pass@example.com/x')).toBe('https://example.com/x');
    expect(redact('ssh://user:pass@host/path')).toBe('ssh://user@host/path');
  });

  it('E47 GitHub tokens', () => {
    expect(redact('ghp_abcdefghijklmnopqrstuvwxyz12')).toBe(MASK);
    expect(redact('github_pat_abcdefghijklmnopqrst')).toBe(MASK);
  });

  it('E47 OpenAI / Slack / AWS / JWT / PEM', () => {
    expect(redact('sk-abcdefghijklmnopqrstuvwxyz')).toBe(MASK);
    expect(redact('xoxb-1234567890-abcdef')).toBe(MASK);
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe(MASK);
    expect(redact('eyJabcdefgh.defghijkl.mnopqrstuv')).toBe(MASK);
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe(MASK);
  });

  it('E47 idempotent', () => {
    const once = redact(`ahb_${'c'.repeat(43)}`);
    expect(redact(once)).toBe(MASK);
  });

  it('Authorization: Basic / token 后面的凭据也打码（curl -v -u 的输出，审查 6041423500 第 2 条）', () => {
    const b64 = Buffer.from(['deploy', 'Sup3rS3cretPw'].join(':')).toString('base64');
    for (const line of [
      `> Authorization: Basic ${b64}`,
      `> authorization: basic ${b64}`,
      `Proxy-Authorization: Basic ${b64}`,
      `Authorization: Token ${b64}`,
      `x-access-token: token ${b64}`,
    ]) {
      const out = redact(line);
      expect(out).not.toContain(b64);
      expect(out).not.toContain(b64.slice(0, 8));
      expect(out).toContain(MASK);
    }
    expect(redact(`Authorization: Basic ${b64}`)).toBe(`Authorization: ${MASK}`);
  });
  it('没闭合的 PRIVATE KEY：从 BEGIN 打码到文末（head -c 400 id_rsa，e2ee818 复审第 ② 条）', () => {
    const body = 'MIIEpAIBAAKCAQEA1x9Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7Kq7';
    for (const text of [
      `-----BEGIN RSA PRIVATE KEY-----\n${body}\n${body}`,
      `$ head -c 400 id_rsa\n-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n$ echo done\ndone\n`,
      `ok -----BEGIN PRIVATE KEY-----${body}`,
    ]) {
      const out = redact(text);
      expect(out).not.toContain(body.slice(0, 8));
      expect(out).not.toContain(body.slice(-8));
      expect(out).toContain(MASK);
      expect(redact(out)).toBe(out);
    }
    expect(redact(`$ head -c 400 id_rsa\n-----BEGIN RSA PRIVATE KEY-----\n${body}`)).toBe(
      `$ head -c 400 id_rsa\n${MASK}`,
    );
    // 闭合的块照旧只打码这一块，后面的文字保留。
    const closed = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\nafter`;
    expect(redact(closed)).toBe(`${MASK}\nafter`);
  });

  it('URL 凭据不依赖词边界：紧贴字母数字的 https://user:pass@ 也打码（e2ee818 复审第 ③ 条）', () => {
    for (const [i, o] of [
      ['xhttps://u:p4ssw0rdXYZ@h', 'xhttps://h'],
      [
        'abc123http://deploy:Sup3rS3cret@git.example.com/r.git',
        'abc123http://git.example.com/r.git',
      ],
      ['_https://deploy:Sup3rS3cret@h/x', '_https://h/x'],
      ['ssh://u:Sup3rS3cret@h', 'ssh://u@h'],
      ['xssh://u:Sup3rS3cret@h', 'xssh://u@h'],
    ]) {
      expect(redact(i!)).toBe(o);
    }
  });
  it('紧贴字母数字的令牌也打码（#315 复审非阻塞 ②）：开头不要求 \\b', () => {
    const ahu = `ahu_${'Qw9'.repeat(14)}Q`;
    const jwt = `eyJ${'Hh1'.repeat(4)}.${'Pp2'.repeat(4)}.${'Sg3'.repeat(4)}`;
    for (const [glued, tok] of [
      [`abc${ahu}`, ahu],
      [`zgithub_pat_${'Ab3'.repeat(8)}`, `github_pat_${'Ab3'.repeat(8)}`],
      [`tokghp_${'Zq9'.repeat(8)}`, `ghp_${'Zq9'.repeat(8)}`],
      [`fooxoxb-${'12ab'.repeat(4)}`, `xoxb-${'12ab'.repeat(4)}`],
      [`keyAKIA${'QW3RTY7UIOP2ASDF'}`, `AKIA${'QW3RTY7UIOP2ASDF'}`],
      [`xxx${jwt}`, jwt],
      [`Bearer${jwt}`, jwt],
    ] as const) {
      const out = redact(glued);
      expect(out).not.toContain(tok.slice(-8));
      expect(out).toContain(MASK);
    }
  });

  it('sk-：URL 编码后的 key%3Dsk-… 打码；普通单词里的 “…sk-” 不误伤', () => {
    const sk = `sk-${'Ab3'.repeat(8)}`;
    expect(redact(`https://h/x?key%3D${sk}`)).toBe(`https://h/x?key%3D${MASK}`);
    expect(redact(`q=a%20${sk}`)).toBe(`q=a%20${MASK}`);
    for (const s of [
      'api-gfm-task-list-item-from-markdown',
      'micromark-extension-gfm-task-list-items-extension',
      'disk-usage-report-generator-2026',
      'abcsk-not-a-secret-just-words',
    ]) {
      expect(redact(s)).toBe(s);
    }
  });
});
