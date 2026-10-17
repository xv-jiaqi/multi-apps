import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    include: [
      '@testing-library/jest-dom/vitest',
      '@testing-library/react',
      '@repo/shared',
      '@repo/stores',
      'mobx',
      'mobx-react-lite',
      '@repo/ui-web > @radix-ui/react-alert-dialog',
      '@repo/ui-web > @radix-ui/react-dialog',
      '@repo/ui-web > @radix-ui/react-popover',
      '@repo/ui-web > @radix-ui/react-select',
      '@repo/ui-web > @radix-ui/react-slot',
      '@repo/ui-web > class-variance-authority',
      '@repo/ui-web > clsx',
      '@repo/ui-web > lucide-react',
      '@repo/ui-web > tailwind-merge',
    ],
  },
  test: {
    include: ['src/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
