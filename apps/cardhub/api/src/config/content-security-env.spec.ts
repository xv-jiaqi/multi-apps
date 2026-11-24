import { contentSecurityEnvError, readContentSecurityEnv } from './content-security-env';

describe('readContentSecurityEnv', () => {
  it('treats empty credentials and empty test switch as unconfigured', () => {
    const env = readContentSecurityEnv({
      NODE_ENV: 'development',
      WECHAT_APP_ID: '  ',
      WECHAT_APP_SECRET: '',
      CONTENT_SECURITY_TEST_RESULT: '  ',
    });
    expect(env.credentialsConfigured).toBe(false);
    expect(env.testResult).toBeNull();
    expect(contentSecurityEnvError(env)).toBeUndefined();
  });

  it('parses a test switch in non-production', () => {
    const env = readContentSecurityEnv({
      NODE_ENV: 'test',
      CONTENT_SECURITY_TEST_RESULT: 'RISKY',
    });
    expect(env.testResult).toBe('risky');
    expect(contentSecurityEnvError(env)).toBeUndefined();
  });

  it('rejects an unknown test-switch value', () => {
    expect(() => readContentSecurityEnv({ CONTENT_SECURITY_TEST_RESULT: 'block' })).toThrow(
      'CONTENT_SECURITY_TEST_RESULT must be empty or one of: pass, review, risky',
    );
  });

  it('flags a test switch in production so startup can fail closed', () => {
    const env = readContentSecurityEnv({
      NODE_ENV: 'production',
      CONTENT_SECURITY_TEST_RESULT: 'pass',
      WECHAT_APP_ID: 'wx-app',
      WECHAT_APP_SECRET: 'wx-secret',
    });
    expect(env.credentialsConfigured).toBe(true);
    expect(contentSecurityEnvError(env)).toBe(
      'CONTENT_SECURITY_TEST_RESULT must not be set when NODE_ENV=production',
    );
  });
});
