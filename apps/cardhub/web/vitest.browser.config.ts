import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Page } from 'playwright';
import { playwright } from '@vitest/browser-playwright';
import type { BrowserCommand } from 'vitest/node';
import { defineConfig } from 'vitest/config';

const CACHED_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
const CACHED_GIF_URL = /https:\/\/img\.cardhub\.test\/cached\.gif(?:\?.*)?$/;

function playwrightPage(context: { provider: unknown; sessionId: string }) {
  const provider = context.provider as { getPage?: (sessionId: string) => Page };
  if (!provider.getPage) {
    throw new Error('Playwright page is not available');
  }
  return provider.getPage(context.sessionId);
}

const installCachedGifRoute: BrowserCommand<[]> = async (context) => {
  const page = playwrightPage(context);
  await page.unroute(CACHED_GIF_URL).catch(() => undefined);
  await page.route(CACHED_GIF_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/gif',
      headers: { 'cache-control': 'public, max-age=86400' },
      body: CACHED_GIF,
    });
  });
};

const uninstallCachedGifRoute: BrowserCommand<[]> = async (context) => {
  const page = playwrightPage(context);
  await page.unroute(CACHED_GIF_URL).catch(() => undefined);
};

function frameButton(context: { provider: unknown; sessionId: string }, name: string) {
  return playwrightPage(context)
    .frameLocator('iframe[data-vitest="true"]')
    .getByRole('button', { name, exact: true });
}

const clickInFrame: BrowserCommand<[string]> = async (context, name) => {
  await frameButton(context, name).click();
};

const pressEnterInFrame: BrowserCommand<[string]> = async (context, name) => {
  await frameButton(context, name).press('Enter');
};

const emulateReducedMotion: BrowserCommand<['reduce' | 'no-preference']> = async (
  context,
  reducedMotion,
) => {
  const page = playwrightPage(context);
  await page.emulateMedia({ reducedMotion });
};

const setViewport: BrowserCommand<[number, number]> = async (context, width, height) => {
  const page = playwrightPage(context);
  await page.setViewportSize({ width: Math.max(width, 800), height: Math.max(height, 900) });
  await page.evaluate(
    ({ width: nextWidth, height: nextHeight }) => {
      const iframe = document.querySelector('iframe[data-vitest="true"]');
      if (!(iframe instanceof HTMLIFrameElement)) {
        throw new Error('missing vitest iframe');
      }
      iframe.style.width = `${nextWidth}px`;
      iframe.style.height = `${nextHeight}px`;
      iframe.style.maxWidth = `${nextWidth}px`;
      iframe.style.transform = 'none';
    },
    { width, height },
  );
};

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
      '@testing-library/user-event',
      '@sentry/react',
      '@repo/shared',
      'axe-core',
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
    // Same reporting line as the jsdom suite. Browser mode keeps its own
    // worker count; only the slow-test threshold is shared.
    slowTestThreshold: 1_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      commands: {
        installCachedGifRoute,
        uninstallCachedGifRoute,
        clickInFrame,
        pressEnterInFrame,
        setViewport,
        emulateReducedMotion,
      },
    },
  },
});
