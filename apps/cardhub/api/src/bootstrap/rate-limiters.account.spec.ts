import { createHmac } from 'node:crypto';
import {
  AUTH_ACCOUNT_KEY_LABEL,
  TRPC_MAX_BATCH_SIZE,
  authAccountKey,
  authAccountKeySecret,
  createAuthAccountLimiter,
  normalizeAuthAccount,
  parseTrpcProcedures,
  productionRateLimitConfigs,
  readAuthAccount,
  trpcCallRejection,
} from './rate-limiters';

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
    const derived = createHmac('sha256', 'unit-test-secret')
      .update(AUTH_ACCOUNT_KEY_LABEL)
      .digest();
    const expected = createHmac('sha256', derived).update('foo@bar.com').digest('hex');
    expect(digest).toBe(expected);
    const rawSecretMac = createHmac('sha256', 'unit-test-secret')
      .update('foo@bar.com')
      .digest('hex');
    expect(digest).not.toBe(rawSecretMac);
  });

  it('throws when JWT_SECRET is missing', () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(() => authAccountKeySecret()).toThrow(
        'JWT_SECRET is required to derive auth account rate-limit keys',
      );
      expect(() => authAccountKey('a@b.c')).toThrow(
        'JWT_SECRET is required to derive auth account rate-limit keys',
      );
      expect(() => createAuthAccountLimiter({ sendCommand: () => Promise.resolve(null) })).toThrow(
        'JWT_SECRET is required to derive auth account rate-limit keys',
      );
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });

  it('reads a login identifier from a raw body and a tRPC batch body', () => {
    const password = 'long-enough';
    expect(
      readAuthAccount({
        url: '/trpc/auth.login',
        body: { identifier: '  A@B.C ', password },
      }),
    ).toBe('a@b.c');
    expect(
      readAuthAccount({
        url: '/trpc/auth.login?batch=1',
        body: { 0: { identifier: '  A@B.C ', password } },
      }),
    ).toBe('a@b.c');
    expect(
      readAuthAccount({
        url: '/trpc/health.ping,auth.login?batch=1',
        body: {
          0: {},
          1: {
            identifier: 'User',
            password,
            json: { identifier: 'decoy@x.test', password },
          },
        },
      }),
    ).toBe('user');
    expect(
      readAuthAccount({
        url: '/trpc/auth.login',
        body: {
          identifier: 'Victim@X.test',
          password,
          json: { identifier: `random-${password}`, password },
        },
      }),
    ).toBe('victim@x.test');
    expect(
      readAuthAccount({
        url: '/trpc/auth.login',
        body: { json: { identifier: 'only-inside-json', password } },
      }),
    ).toBeUndefined();
    expect(
      readAuthAccount({ url: '/trpc/auth.login', body: { identifier: '  A@B.C ' } }),
    ).toBeUndefined();
    expect(
      readAuthAccount({ url: '/trpc/auth.register', body: { email: 'a@b.c' } }),
    ).toBeUndefined();
    expect(readAuthAccount({ url: '/trpc/auth.changePassword', body: {} })).toBeUndefined();
    expect(readAuthAccount({ url: '/trpc/auth.login' })).toBeUndefined();
    expect(
      readAuthAccount({
        path: '/auth%2Elogin',
        body: { identifier: 'Encoded@X.test', password },
      }),
    ).toBe('encoded@x.test');
    expect(
      readAuthAccount({
        path: '/auth%2elogin',
        body: { identifier: 'Encoded@X.test', password },
      }),
    ).toBe('encoded@x.test');
    expect(
      readAuthAccount({
        path: '/auth.login%2Cauth.login',
        query: { batch: '1' },
        body: {
          0: { identifier: 'First@X.test', password },
          1: { identifier: 'Second@X.test', password },
        },
      }),
    ).toBe('first@x.test');
    expect(
      readAuthAccount({ path: '/Auth.Login', body: { identifier: 'Encoded@X.test' } }),
    ).toBeUndefined();
    expect(
      readAuthAccount({ path: '/auth%252Elogin', body: { identifier: 'Encoded@X.test' } }),
    ).toBeUndefined();
    expect(readAuthAccount({ path: '/%E0%A4%A', body: { identifier: 'Encoded@X.test' } })).toBe(
      undefined,
    );
  });

  it('parses procedure names the way tRPC does', () => {
    const encoded = parseTrpcProcedures({ path: '/auth%2Elogin' });
    expect(encoded).toEqual({ ok: true, procedures: ['auth.login'], batch: false });
    const encodedComma = parseTrpcProcedures({
      path: '/auth.login%2Cauth.register',
      query: { batch: '1' },
    });
    expect(encodedComma).toEqual({
      ok: true,
      procedures: ['auth.login', 'auth.register'],
      batch: true,
    });
    const notBatch = parseTrpcProcedures({ path: '/auth.login%2Cauth.register' });
    expect(notBatch).toEqual({
      ok: true,
      procedures: ['auth.login,auth.register'],
      batch: false,
    });
    expect(parseTrpcProcedures({ path: '/%E0%A4%A' })).toEqual({ ok: false });
    expect(productionRateLimitConfigs.authMutation.skip({ path: '/auth%2Elogin' })).toBe(false);
    expect(productionRateLimitConfigs.authMutation.skip({ path: '/auth%2elogin' })).toBe(false);
    expect(productionRateLimitConfigs.authMutation.skip({ path: '/Auth.Login' })).toBe(true);
    expect(productionRateLimitConfigs.authMutation.skip({ path: '/%E0%A4%A' })).toBe(true);

    const pings = (count: number) =>
      `/${Array.from({ length: count }, () => 'health.ping').join(',')}`;
    expect(trpcCallRejection({ path: pings(TRPC_MAX_BATCH_SIZE), query: { batch: '1' } })).toBe(
      undefined,
    );
    expect(trpcCallRejection({ path: pings(TRPC_MAX_BATCH_SIZE + 1), query: { batch: '1' } })).toBe(
      'batch-size',
    );
    expect(trpcCallRejection({ path: '/auth.login,auth.login', query: { batch: '1' } })).toBe(
      'auth-writes',
    );
    expect(
      trpcCallRejection({ path: '/health.ping,auth.login', query: { batch: '1' } }),
    ).toBeUndefined();
    expect(trpcCallRejection({ path: '/auth.login%2Cauth.login', query: { batch: '1' } })).toBe(
      'auth-writes',
    );
    expect(trpcCallRejection({ path: '/%E0%A4%A' })).toBe('decode');
  });
});
