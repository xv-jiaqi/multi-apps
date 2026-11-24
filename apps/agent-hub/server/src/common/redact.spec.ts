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
});
