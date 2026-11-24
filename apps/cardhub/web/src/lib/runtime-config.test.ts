import { assertRuntimeConfigScript, parseRuntimeConfigScript } from './runtime-config';

function script(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value], index, all) => {
    const comma = index < all.length - 1 ? ',' : '';
    return `  ${key}: "${value}"${comma}`;
  });
  return `window.__CARDHUB_CONFIG__ = {\n${lines.join('\n')}\n};\n`;
}

describe('runtime config assertion', () => {
  it('accepts a valid required TRPC_URL', () => {
    const config = assertRuntimeConfigScript(
      script({ TRPC_URL: 'https://api-staging.card-hub.app/trpc' }),
    );
    expect(config).toEqual({ TRPC_URL: 'https://api-staging.card-hub.app/trpc' });
  });

  it('accepts optional Sentry fields when they are well formed', () => {
    const config = assertRuntimeConfigScript(
      script({
        TRPC_URL: 'https://api.card-hub.app/trpc',
        SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
        SENTRY_ENVIRONMENT: 'production',
        GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
      }),
    );
    expect(config.SENTRY_DSN).toBe('https://public@example.ingest.sentry.io/123');
    expect(config.SENTRY_ENVIRONMENT).toBe('production');
    expect(config.GIT_SHA).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('fails and names the field when TRPC_URL is missing', () => {
    expect(() => assertRuntimeConfigScript(script({}))).toThrow(
      /config\.js is invalid: missing required field TRPC_URL/,
    );
  });

  it('fails and names the field when TRPC_URL has the wrong format', () => {
    expect(() =>
      assertRuntimeConfigScript(script({ TRPC_URL: 'https://api.card-hub.app' })),
    ).toThrow(/config\.js is invalid: field TRPC_URL has an invalid format/);
  });

  it('fails and names the field when SENTRY_DSN has the wrong format', () => {
    expect(() =>
      assertRuntimeConfigScript(
        script({
          TRPC_URL: 'https://api.card-hub.app/trpc',
          SENTRY_DSN: 'javascript:alert(1)',
        }),
      ),
    ).toThrow(/config\.js is invalid: field SENTRY_DSN has an invalid format/);
  });

  it('fails when the script is not a config assignment', () => {
    expect(() =>
      assertRuntimeConfigScript('window.__CARDHUB_CONFIG__ = window.__CARDHUB_CONFIG__ || {};'),
    ).toThrow(/expected window\.__CARDHUB_CONFIG__/);
  });

  it('parses the entrypoint script shape', () => {
    expect(
      parseRuntimeConfigScript(
        'window.__CARDHUB_CONFIG__ = {\n  TRPC_URL: "https://api.card-hub.app/trpc"\n};\n',
      ),
    ).toEqual({ TRPC_URL: 'https://api.card-hub.app/trpc' });
  });
});
