import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(webRoot, 'docker-entrypoint.d', '10-cardhub-runtime-config.sh');

function runScript(trpcUrl: string, extraEnv: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cardhub-runtime-config-'));
  const configPath = path.join(dir, 'config.js');
  const headersPath = path.join(dir, 'security-headers.inc');
  try {
    execFileSync('sh', [scriptPath], {
      env: {
        ...process.env,
        CARDHUB_CONFIG_FILE: configPath,
        CARDHUB_SECURITY_HEADERS_FILE: headersPath,
        TRPC_URL: trpcUrl,
        SENTRY_DSN: '',
        SENTRY_ENVIRONMENT: '',
        GIT_SHA: '',
        ...extraEnv,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      ok: true as const,
      config: readFileSync(configPath, 'utf8'),
      headers: readFileSync(headersPath, 'utf8'),
    };
  } catch (error) {
    return {
      ok: false as const,
      stderr:
        error instanceof Error && 'stderr' in error
          ? String((error as Error & { stderr: unknown }).stderr)
          : String(error),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('runtime config entrypoint', () => {
  it('writes a JS config file for a valid tRPC URL', () => {
    const result = runScript('https://api-staging.card-hub.app/trpc');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBe(
      'window.__CARDHUB_CONFIG__ = {\n' +
        '  TRPC_URL: "https://api-staging.card-hub.app/trpc"\n' +
        '};\n',
    );
    expect(result.headers).toContain('X-Content-Type-Options "nosniff"');
    expect(result.headers).toContain('Referrer-Policy "strict-origin-when-cross-origin"');
    expect(result.headers).toContain("frame-ancestors 'none'");
    expect(result.headers).toContain("connect-src 'self' https://api-staging.card-hub.app;");
    expect(result.headers).not.toContain('sentry');
  });

  it('writes optional Sentry runtime config when values are set', () => {
    const result = runScript('https://api.card-hub.app/trpc', {
      SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
      SENTRY_ENVIRONMENT: 'production',
      GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBe(
      'window.__CARDHUB_CONFIG__ = {\n' +
        '  TRPC_URL: "https://api.card-hub.app/trpc",\n' +
        '  SENTRY_DSN: "https://public@example.ingest.sentry.io/123",\n' +
        '  SENTRY_ENVIRONMENT: "production",\n' +
        '  GIT_SHA: "0123456789abcdef0123456789abcdef01234567"\n' +
        '};\n',
    );
    expect(result.headers).toContain(
      "connect-src 'self' https://api.card-hub.app https://example.ingest.sentry.io;",
    );
  });

  it('keeps a custom Sentry port in connect-src', () => {
    const result = runScript('https://api.card-hub.app/trpc', {
      SENTRY_DSN: 'https://k@sentry.example.com:9000/2',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toContain('https://sentry.example.com:9000');
  });

  it('exits when the nginx header file cannot be written', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cardhub-runtime-config-'));
    const configPath = path.join(dir, 'config.js');
    try {
      execFileSync('sh', [scriptPath], {
        env: {
          ...process.env,
          CARDHUB_CONFIG_FILE: configPath,
          CARDHUB_SECURITY_HEADERS_FILE: '',
          TRPC_URL: 'https://api.card-hub.app/trpc',
          SENTRY_DSN: '',
          SENTRY_ENVIRONMENT: '',
          GIT_SHA: '',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      throw new Error('expected the entrypoint to fail');
    } catch (error) {
      const stderr =
        error instanceof Error && 'stderr' in error
          ? String((error as Error & { stderr: unknown }).stderr)
          : String(error);
      expect(stderr).toContain('cannot write /etc/nginx/conf.d/security-headers.inc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits empty Sentry config and unknown git sha', () => {
    const result = runScript('https://api.card-hub.app/trpc', {
      SENTRY_DSN: '',
      SENTRY_ENVIRONMENT: '',
      GIT_SHA: 'unknown',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBe(
      'window.__CARDHUB_CONFIG__ = {\n' + '  TRPC_URL: "https://api.card-hub.app/trpc"\n' + '};\n',
    );
  });

  it.each([
    ['semicolon', 'https://api.card-hub.app;x/trpc'],
    ['single quote', "https://api.card-hub.app'/trpc"],
  ])('rejects a %s in TRPC_URL', (_name, value) => {
    const result = runScript(value);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      stderr: expect.stringContaining('semicolons'),
    });
  });

  it.each([
    ['embedded newline', 'https://api.card-hub.app/trpc\nhttps://evil.example/trpc'],
    ['trailing newline', 'https://api.card-hub.app/trpc\n'],
    ['carriage return', 'https://api.card-hub.app/trpc\r'],
  ])('rejects %s before URL validation', (_name, value) => {
    const result = runScript(value);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      stderr: expect.stringContaining('must not contain control characters'),
    });
  });

  it.each([
    ['script quote breakout', 'https://public@example.ingest.sentry.io/123"'],
    ['embedded whitespace', 'https://public@example.ingest.sentry.io/123 evil'],
    ['javascript URL', 'javascript:alert(1)'],
  ])('rejects invalid SENTRY_DSN: %s', (_name, value) => {
    const result = runScript('https://api.card-hub.app/trpc', {
      SENTRY_DSN: value,
    });

    expect(result.ok).toBe(false);
  });
});
