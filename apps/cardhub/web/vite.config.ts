import { defineConfig } from 'vite';
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
});
