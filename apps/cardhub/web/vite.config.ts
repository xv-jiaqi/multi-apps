/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
