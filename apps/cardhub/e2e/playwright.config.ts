import { defineConfig, devices } from '@playwright/test';
import { apiDir, apiEnv, apiOrigin, ensureDbScript, stringEnv, webDir, webOrigin } from './harness';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: webOrigin,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
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
      env: apiEnv,
    },
    {
      command: 'pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
      cwd: webDir,
      url: webOrigin,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: stringEnv({
        ...process.env,
        CARDHUB_API_ORIGIN: apiOrigin,
      }),
    },
  ],
});
