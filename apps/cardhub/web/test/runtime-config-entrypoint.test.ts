import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(webRoot, 'docker-entrypoint.d', '10-cardhub-runtime-config.sh');

function runScript(trpcUrl: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cardhub-runtime-config-'));
  const configPath = path.join(dir, 'config.js');
  try {
    execFileSync('sh', [scriptPath], {
      env: {
        ...process.env,
        CARDHUB_CONFIG_FILE: configPath,
        TRPC_URL: trpcUrl,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true as const, config: readFileSync(configPath, 'utf8') };
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

    expect(result).toEqual({
      ok: true,
      config:
        'window.__CARDHUB_CONFIG__ = {\n' +
        '  TRPC_URL: "https://api-staging.card-hub.app/trpc"\n' +
        '};\n',
    });
  });

  it('rejects multiline values before URL validation', () => {
    const result = runScript('https://api.card-hub.app/trpc\nhttps://evil.example/trpc');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      stderr: expect.stringContaining('must not contain control characters'),
    });
  });
});
