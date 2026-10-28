import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    // Same 1s line as the app suites, so a slow shared test shows up in CI
    // before the 5000ms timeout.
    slowTestThreshold: 1_000,
  },
});
