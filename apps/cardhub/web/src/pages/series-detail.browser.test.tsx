import axe from 'axe-core';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter, Route, Routes } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setViewport: (width: number, height: number) => Promise<void>;
    readPixels: (
      selector: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => Promise<{
      r: number;
      g: number;
      b: number;
    }>;
  }
}

const LONG = `W`.repeat(80);

const readyQuery = {
  data: [] as unknown[],
  isLoading: false,
  isPending: false,
  isFetching: false,
  isError: false,
  isSuccess: true,
  error: null,
  errorUpdateCount: 0,
  dataUpdatedAt: 1,
  refetch: vi.fn(),
};

const series = {
  slug: 'starlight-novice',
  title: '星光新手',
  description: '浅色渐变，用来量没有封面时的白字。',
  coverUrl: null,
  releaseDate: '2024-03-15',
  category: { slug: 'tcg', name: '构筑对战' },
  subsets: [
    { slug: 'long-subset', name: LONG, kind: 'BASE' as const, sortOrder: 1 },
    { slug: 'short-subset', name: '短子集', kind: 'INSERT' as const, sortOrder: 2 },
  ],
  cards: [
    {
      slug: 'card-long',
      name: '长名卡',
      rarity: 'rare',
      imageUrl: null,
      cardNumber: '1',
      subsetSlug: 'long-subset',
    },
    {
      slug: 'card-short',
      name: '短名卡',
      rarity: 'common',
      imageUrl: null,
      cardNumber: '2',
      subsetSlug: 'short-subset',
    },
  ],
};

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    useUtils: () => ({
      comments: {
        listForCard: { invalidate: vi.fn() },
        listForSeries: { invalidate: vi.fn() },
      },
    }),
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: false,
        }),
      },
    },
    series: {
      bySlug: {
        useQuery: () => ({ ...readyQuery, data: series }),
      },
    },
    comments: {
      listForCard: { useQuery: () => readyQuery },
      listForSeries: { useQuery: () => readyQuery },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createForSeries: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }) },
    },
    reports: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { SeriesDetailPage } from './series-detail';

function renderSeries() {
  return render(
    <MemoryRouter initialEntries={['/series/starlight-novice']}>
      <Routes>
        <Route path="/series/:seriesSlug" element={<SeriesDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: { r: number; g: number; b: number }) {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrast(
  foreground: { r: number; g: number; b: number },
  background: { r: number; g: number; b: number },
) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(
  foreground: { r: number; g: number; b: number },
  alpha: number,
  background: { r: number; g: number; b: number },
) {
  return {
    r: alpha * foreground.r + (1 - alpha) * background.r,
    g: alpha * foreground.g + (1 - alpha) * background.g,
    b: alpha * foreground.b + (1 - alpha) * background.b,
  };
}

function oklabToSrgb(lightness: number, a: number, b: number) {
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l ** 3;
  const m3 = m ** 3;
  const s3 = s ** 3;
  const encode = (channel: number) => {
    const clamped = Math.min(1, Math.max(0, channel));
    return (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255;
  };
  return {
    r: encode(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: encode(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: encode(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  };
}

function parseColor(value: string) {
  const oklab = value.match(
    /oklab\(\s*([-+]?[\d.]+)\s+([-+]?[\d.]+)\s+([-+]?[\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/,
  );
  if (oklab) {
    return {
      ...oklabToSrgb(Number(oklab[1]), Number(oklab[2]), Number(oklab[3])),
      a: oklab[4] === undefined ? 1 : Number(oklab[4]),
    };
  }
  const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (srgb) {
    return {
      r: Number(srgb[1]) * 255,
      g: Number(srgb[2]) * 255,
      b: Number(srgb[3]) * 255,
      a: srgb[4] === undefined ? 1 : Number(srgb[4]),
    };
  }
  const modern = value.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/,
  );
  if (!modern) throw new Error(`unparsed color ${value}`);
  const alpha = modern[4];
  return {
    r: Number(modern[1]),
    g: Number(modern[2]),
    b: Number(modern[3]),
    a:
      alpha === undefined
        ? 1
        : alpha.endsWith('%')
          ? Number(alpha.slice(0, -1)) / 100
          : Number(alpha),
  };
}

function averageAt(
  selector: string,
  origin: DOMRect,
  target: DOMRect,
  dx: number,
  dy: number,
  width: number,
  height: number,
) {
  return commands.readPixels(selector, {
    x: target.left - origin.left + dx,
    y: target.top - origin.top + dy,
    width,
    height,
  });
}

beforeEach(async () => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
});

describe('series detail at 375px', () => {
  it('wraps a long subset jump link inside the viewport', async () => {
    renderSeries();
    const link = await screen.findByRole('link', { name: LONG });
    expect(link).toHaveClass('wrap-anywhere', 'min-w-0', 'max-w-full');
    expect(window.innerWidth).toBe(375);
    expect(link.scrollWidth).toBeLessThanOrEqual(link.clientWidth + 1);
    const linkBox = link.getBoundingClientRect();
    expect(linkBox.right).toBeLessThanOrEqual(376);
    console.info(
      JSON.stringify({
        linkRight: Number(linkBox.right.toFixed(1)),
        linkWidth: Number(linkBox.width.toFixed(1)),
        linkScrollWidth: link.scrollWidth,
        linkClientWidth: link.clientWidth,
      }),
    );
    expect(linkBox.height).toBeGreaterThan(24);
    expect(link.textContent).toBe(LONG);
    const scrolling = document.scrollingElement;
    expect(scrolling!.scrollWidth).toBeLessThanOrEqual(scrolling!.clientWidth + 1);
  });

  it('keeps white hero text and the category focus ring above the contrast floors without a cover', async () => {
    renderSeries();
    const hero = (await screen.findAllByRole('banner')).find((node) =>
      node.className.includes('rounded-3xl'),
    );
    expect(hero).toBeTruthy();
    const overlay = hero?.querySelector('.absolute.inset-0');
    expect(overlay).toHaveClass('bg-black/65');
    expect(overlay?.className ?? '').not.toContain('bg-black/15');

    const release = screen.getByText(/发售于/);
    const releaseColor = parseColor(getComputedStyle(release).color);
    const heroBox = hero!.getBoundingClientRect();
    const releaseBox = release.getBoundingClientRect();
    const releaseBackground = await averageAt(
      'header.rounded-3xl',
      heroBox,
      releaseBox,
      4,
      -8,
      16,
      4,
    );
    const releasePainted = composite(releaseColor, releaseColor.a, releaseBackground);
    const releaseRatio = contrast(releasePainted, releaseBackground);

    const description = screen.getByText('浅色渐变，用来量没有封面时的白字。');
    const descriptionColor = parseColor(getComputedStyle(description).color);
    const descriptionBox = description.getBoundingClientRect();
    const descriptionBackground = await averageAt(
      'header.rounded-3xl',
      heroBox,
      descriptionBox,
      4,
      -6,
      24,
      3,
    );
    const descriptionPainted = composite(
      descriptionColor,
      descriptionColor.a,
      descriptionBackground,
    );
    const descriptionRatio = contrast(descriptionPainted, descriptionBackground);

    const chip = screen
      .getAllByRole('link', { name: '构筑对战' })
      .find((node) => node.className.includes('rounded-full'));
    if (!chip) throw new Error('missing category chip');
    chip.focus({ focusVisible: true });
    const chipBox = chip.getBoundingClientRect();
    const ringSamples = [];
    for (const dx of [-1, -2, -3, -4, -6, -12]) {
      ringSamples.push({
        dx,
        color: await averageAt(
          'header.rounded-3xl',
          heroBox,
          chipBox,
          dx,
          chipBox.height / 2 - 1,
          1,
          2,
        ),
      });
    }
    const ringSample = ringSamples.reduce((best, item) =>
      luminance(item.color) > luminance(best.color) ? item : best,
    );
    const besideRing = ringSamples.find((item) => item.dx === -12)?.color;
    if (!besideRing) throw new Error('missing ring background');
    const ringRatio = contrast(ringSample.color, besideRing);
    console.info(
      JSON.stringify({
        releaseRatio: Number(releaseRatio.toFixed(2)),
        descriptionRatio: Number(descriptionRatio.toFixed(2)),
        descriptionBackground,
        descriptionPainted,
        ringRatio: Number(ringRatio.toFixed(2)),
        ringDx: ringSample.dx,
        releaseBackground,
        ring: ringSample.color,
        besideRing,
      }),
    );

    expect(releaseRatio).toBeGreaterThanOrEqual(4.5);
    expect(descriptionRatio).toBeGreaterThanOrEqual(4.5);
    expect(ringRatio).toBeGreaterThanOrEqual(3);
  });
});

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

describe('series detail WCAG', () => {
  it.each([
    ['zh-CN', 1440],
    ['zh-CN', 375],
    ['en-US', 1440],
    ['en-US', 375],
  ] as const)('has no %s violations at %i px', async (locale, width) => {
    rootStore.locale.setLocale(locale);
    await commands.setViewport(width, 900);
    renderSeries();
    expect(await screen.findByRole('heading', { level: 1, name: '星光新手' })).toBeInTheDocument();

    const results = await axe.run(document.body, {
      runOnly: { type: 'tag', values: [...AXE_TAGS] },
    });
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target).slice(0, 3),
      })),
    ).toEqual([]);
  });
});
