import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 2048 },
  optimizeDeps: { include: ['@agent-hub/contract', '@repo/ui-web'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    // Runs in the same CI test step as @cardhub/web. Cap workers so this
    // suite does not fork one jsdom per core beside the web suite.
    maxWorkers: 2,
    slowTestThreshold: 1_000,
  },
});
