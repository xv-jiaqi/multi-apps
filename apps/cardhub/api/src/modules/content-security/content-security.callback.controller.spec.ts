import { callbackAuthorized } from './content-security.callback.controller';

describe('callbackAuthorized', () => {
  it('requires the configured token when one is set', () => {
    expect(
      callbackAuthorized({
        env: { callbackToken: 'secret', credentialsConfigured: true },
        headerToken: 'secret',
      }),
    ).toBe(true);
    expect(
      callbackAuthorized({
        env: { callbackToken: 'secret', credentialsConfigured: true },
        headerToken: 'nope',
      }),
    ).toBe(false);
  });

  it('rejects unauthenticated callbacks when WeChat credentials are configured', () => {
    expect(
      callbackAuthorized({
        env: { callbackToken: '', credentialsConfigured: true },
        headerToken: undefined,
      }),
    ).toBe(false);
  });

  it('rejects callbacks when the token is empty, even without credentials', () => {
    expect(
      callbackAuthorized({
        env: { callbackToken: '', credentialsConfigured: false },
        headerToken: undefined,
      }),
    ).toBe(false);
  });
});
