import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

function pnpmStore(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'node_modules', '.pnpm');
    try {
      readdirSync(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error('pnpm store not found');
}

function loadPngjs(): {
  PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
} {
  const root = pnpmStore();
  const dir = readdirSync(root).find((name) => name.startsWith('pngjs@'));
  if (!dir) throw new Error('pngjs is not installed');
  const require = createRequire(import.meta.url);
  return require(`${root}/${dir}/node_modules/pngjs`) as {
    PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
  };
}

const readPixels: BrowserCommand<
  [string, { x: number; y: number; width: number; height: number }]
> = async (context, selector, rect) => {
  const page = playwrightPage(context);
  const locator = page.frameLocator('iframe[data-vitest="true"]').locator(selector).first();
  const [png, box] = await Promise.all([locator.screenshot(), locator.boundingBox()]);
  if (!box) throw new Error(`missing box for ${selector}`);
  const image = loadPngjs().PNG.sync.read(png);
  const scaleX = image.width / box.width;
  const scaleY = image.height / box.height;
  const x0 = Math.max(0, Math.floor(rect.x * scaleX));
  const y0 = Math.max(0, Math.floor(rect.y * scaleY));
  const x1 = Math.min(image.width, Math.ceil((rect.x + rect.width) * scaleX));
  const y1 = Math.min(image.height, Math.ceil((rect.y + rect.height) * scaleY));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * image.width + x) * 4;
      red += image.data[index] ?? 0;
      green += image.data[index + 1] ?? 0;
      blue += image.data[index + 2] ?? 0;
      count += 1;
    }
  }
  if (count === 0) {
    throw new Error(
      `empty pixel sample ${JSON.stringify({ rect, box, image: [image.width, image.height] })}`,
    );
  }
  return { r: red / count, g: green / count, b: blue / count };
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
        readPixels,
        emulateReducedMotion,
      },
    },
  },
});
