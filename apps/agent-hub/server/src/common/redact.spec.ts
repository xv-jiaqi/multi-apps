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
});
