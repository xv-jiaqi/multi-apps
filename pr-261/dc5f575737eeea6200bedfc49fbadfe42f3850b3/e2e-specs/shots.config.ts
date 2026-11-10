import { defineConfig, devices } from '@playwright/test';
import { apiDir, apiEnv, apiOrigin, ensureDbScript, stringEnv } from '/workspace/wt-ch226/apps/cardhub/e2e/harness.ts';

const devOrigin = 'http://127.0.0.1:5181';

export default defineConfig({
  testDir: './shots',
  globalSetup: '/workspace/wt-ch226/apps/cardhub/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: 'test-results-shots',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: devOrigin,
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: [
    {
      command: `node --experimental-strip-types ${ensureDbScript} && exec node dist/main.js`,
      cwd: apiDir,
      url: `${apiOrigin}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...apiEnv, CORS_ORIGIN: devOrigin },
    },
    {
      // `pnpm dev:web` (vite dev) on a free port, proxied to the local API.
      command: 'pnpm dev:web --host 127.0.0.1 --port 5181 --strictPort',
      cwd: '/workspace/wt-ch226',
      url: devOrigin,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: stringEnv({ ...process.env, CARDHUB_API_ORIGIN: apiOrigin }),
    },
  ],
});
