/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'node:path';

const enableVisualizer = process.env.BUNDLE_VISUALIZE === '1';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    enableVisualizer
      ? visualizer({
          filename: 'dist/stats.html',
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
        })
      : null,
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/trpc': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  // The shared packages (@repo/*) ship as CommonJS so the NestJS API can
  // require() them directly. Forcing Vite to pre-bundle them lets us keep the
  // CJS output while still exposing named ES exports to the browser.
  optimizeDeps: {
    include: [
      '@repo/shared',
      '@repo/stores',
      '@repo/trpc-contract',
      '@repo/design-tokens',
      '@repo/ui-web',
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['src/**/*.browser.test.tsx'],
    // This package's tests run beside the API jest suite and agent-hub vitest.
    // Leaving maxWorkers at the CPU count let those runners oversubscribe a
    // 4-core CI machine. Two workers overlap files without taking every core.
    maxWorkers: 2,
    // Vitest's default 300ms marks ordinary tests once the runner is busy.
    // 1s is still 5x under the 5000ms timeout, so a slow test is printed
    // while it is still passing.
    slowTestThreshold: 1_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      // Mirror the API thresholds so CI fails fast when coverage regresses.
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/styles/**', 'src/lib/gradients.ts'],
    },
  },
});
