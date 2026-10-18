import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page } from 'vitest/browser';
import { MarkdownView } from './markdown-view';
import '../styles/globals.css';

const URL = `https://example.com/${'a'.repeat(220)}`;
const INLINE = 'b'.repeat(220);
const CODE_LINE = `const value = "${'c'.repeat(220)}";`;
const TOPIC = [`看这个链接 ${URL}`, '', `\`${INLINE}\``, '', '```', CODE_LINE, '```'].join('\n');
const COMMENT = `${URL}\n还想看 ${INLINE}`;
const NOTE = `${URL}\n想换同名卡`;

function LongContentPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-neutral-900">
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-4">
        <article className="rounded-lg border border-neutral-200 bg-white p-4">
          <h1 className="mb-2 text-lg font-semibold">长内容话题</h1>
          <MarkdownView body={TOPIC} />
        </article>
        <section aria-label="回帖" className="mt-4">
          <ul>
            <li className="rounded-lg border border-neutral-200 p-4">
              <div className="mt-2 min-w-0">
                <MarkdownView body={TOPIC} />
              </div>
            </li>
          </ul>
        </section>
        <section aria-label="评论" className="mt-4">
          <ul>
            <li className="rounded-lg border border-neutral-200 p-4">
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 wrap-anywhere">
                {COMMENT}
              </p>
            </li>
          </ul>
        </section>
        <section aria-label="交易描述" className="mt-4">
          <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[6rem_1fr]">
            <dt className="text-xs uppercase tracking-widest text-neutral-500">联系方式</dt>
            <dd className="min-w-0 font-mono text-neutral-800 wrap-anywhere">{URL}</dd>
            <dt className="text-xs uppercase tracking-widest text-neutral-500">备注</dt>
            <dd className="min-w-0 whitespace-pre-wrap text-neutral-700 wrap-anywhere">{NOTE}</dd>
          </dl>
        </section>
      </main>
    </div>
  );
}

describe('long content at 375px', () => {
  afterEach(() => {
    cleanup();
  });

  it('wraps URLs and inline code, and scrolls code blocks inside their frame', async () => {
    const session = cdp();
    try {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: 375,
        height: 1400,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await page.viewport(375, 1400);
      render(<LongContentPage />);

      const scrolling = document.scrollingElement;
      expect(scrolling).toBeTruthy();
      expect(scrolling!.clientWidth).toBe(375);
      expect(scrolling!.scrollWidth).toBeLessThanOrEqual(scrolling!.clientWidth);

      const overflowingVisible = [
        ...document.querySelectorAll('main article, main li, main section'),
      ].filter(
        (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'visible',
      );
      expect(overflowingVisible).toEqual([]);

      const pres = [...document.querySelectorAll('pre')];
      expect(pres.length).toBeGreaterThanOrEqual(2);
      for (const pre of pres) {
        expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth);
        expect(getComputedStyle(pre).overflowX).toBe('auto');
      }

      expect(screen.getAllByText(URL).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(INLINE).length).toBeGreaterThanOrEqual(1);
      expect(document.body.textContent).toContain(CODE_LINE);

      const topic = document.querySelector('article .wrap-anywhere');
      expect(topic).toBeTruthy();
      expect(getComputedStyle(topic!).overflowWrap).toBe('anywhere');

      const main = document.querySelector('main');
      expect(main).toBeTruthy();
      expect(Math.round(main!.getBoundingClientRect().width)).toBe(375);
      const firstPre = pres[0]!;
      firstPre.scrollLeft = Math.floor((firstPre.scrollWidth - firstPre.clientWidth) / 2);
      await page.screenshot({
        element: main!,
        path: '__screenshots__/wreg1-375-long-content.png',
      });

      await session.send('Emulation.clearDeviceMetricsOverride');
      await page.viewport(1440, 900);
      expect(scrolling!.clientWidth).toBe(1440);
      expect(scrolling!.scrollWidth).toBeLessThanOrEqual(scrolling!.clientWidth);
      const overflowingDesktop = [
        ...document.querySelectorAll('main article, main li, main section'),
      ].filter(
        (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'visible',
      );
      expect(overflowingDesktop).toEqual([]);
      expect(document.querySelector('pre')!.scrollWidth).toBeGreaterThan(
        document.querySelector('pre')!.clientWidth,
      );
    } finally {
      await session.send('Emulation.clearDeviceMetricsOverride');
      await page.viewport(1280, 720);
    }
  });
});
