import { authAccountKey, normalizeAuthAccount, readAuthAccount } from './rate-limiters';

describe('auth account key', () => {
  const previous = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });

  it('hashes the trimmed lowercase account and leaves the plaintext out', () => {
    expect(normalizeAuthAccount('  Foo@Bar.com ')).toBe('foo@bar.com');
    expect(authAccountKey('  Foo@Bar.com ')).toBe(authAccountKey('foo@bar.com'));
    expect(authAccountKey('  Alice  ')).toBe(authAccountKey('alice'));
    expect(authAccountKey('foo@bar.com')).not.toBe(authAccountKey('alice'));
    const digest = authAccountKey('foo@bar.com');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('foo');
  });

  it('reads a login identifier from a raw body and a tRPC batch body', () => {
    expect(readAuthAccount({ url: '/trpc/auth.login', body: { identifier: '  A@B.C ' } })).toBe(
      'a@b.c',
    );
    expect(
      readAuthAccount({
        url: '/trpc/auth.login?batch=1',
        body: { 0: { identifier: '  A@B.C ' } },
      }),
    ).toBe('a@b.c');
    expect(
      readAuthAccount({
        url: '/trpc/health.ping,auth.login?batch=1',
        body: { 0: {}, 1: { json: { identifier: 'User' } } },
      }),
    ).toBe('user');
    expect(
      readAuthAccount({ url: '/trpc/auth.register', body: { email: 'a@b.c' } }),
    ).toBeUndefined();
    expect(readAuthAccount({ url: '/trpc/auth.changePassword', body: {} })).toBeUndefined();
    expect(readAuthAccount({ url: '/trpc/auth.login' })).toBeUndefined();
  });
});
