import { PUBLIC_WEB_ORIGIN_ERROR, resolvePublicWebOrigin } from './public-web-origin';

const DEFAULT_DEV = {
  nodeEnv: 'development',
  corsOrigin:
    'http://localhost:5173,http://localhost:10086,https://card-hub.app,https://staging.card-hub.app,tauri://localhost,https://tauri.localhost',
};

describe('resolvePublicWebOrigin', () => {
  it('prefers localhost over the production sites in the default allowlist', () => {
    expect(resolvePublicWebOrigin(DEFAULT_DEV)).toBe('http://localhost:5173');
  });

  it('uses the first https site in production and skips tauri origins', () => {
    expect(
      resolvePublicWebOrigin({
        nodeEnv: 'production',
        corsOrigin: 'https://tauri.localhost,tauri://localhost,https://staging.card-hub.app',
      }),
    ).toBe('https://staging.card-hub.app');
  });

  it('uses the built-in https site when production CORS is unset', () => {
    expect(resolvePublicWebOrigin({ nodeEnv: 'production' })).toBe('https://card-hub.app');
  });

  it('lets PUBLIC_WEB_ORIGIN override CORS, including surrounding whitespace', () => {
    expect(
      resolvePublicWebOrigin({
        nodeEnv: 'production',
        corsOrigin: 'https://card-hub.app',
        publicWebOrigin: '  https://staging.card-hub.app  ',
      }),
    ).toBe('https://staging.card-hub.app');
  });

  it('treats a blank PUBLIC_WEB_ORIGIN as unset', () => {
    expect(
      resolvePublicWebOrigin({
        nodeEnv: 'development',
        corsOrigin: 'http://127.0.0.1:5173',
        publicWebOrigin: '   ',
      }),
    ).toBe('http://127.0.0.1:5173');
  });

  it.each([
    'https://card-hub.app/',
    'https://card-hub.app/sitemap.xml',
    'https://user:pass@card-hub.app',
    'javascript:alert(1)',
    'https://card-hub.app:0',
    'https://card-hub.app:65536',
    'card-hub.app',
  ])('rejects %s', (publicWebOrigin) => {
    expect(() => resolvePublicWebOrigin({ publicWebOrigin })).toThrow(PUBLIC_WEB_ORIGIN_ERROR);
  });

  it('rejects production when CORS has no https site', () => {
    expect(() =>
      resolvePublicWebOrigin({
        nodeEnv: 'production',
        corsOrigin: 'http://localhost:5173,tauri://localhost',
      }),
    ).toThrow('https CORS_ORIGIN');
  });
});
