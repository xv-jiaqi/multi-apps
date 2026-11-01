import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { t } from '@repo/shared';
import { rootStore } from '../stores/root-store';
import { addCalendarDays, shanghaiToday } from '../lib/shanghai-date';

type SeriesFixture = {
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  cardCount: number;
  releaseDate: string | null;
};

type CategoryFixture = {
  slug: string;
  name: string;
  description: string | null;
  seriesCount: number;
};

type ReleaseFixture = {
  id: string;
  title: string;
  releaseDate: string;
  region: 'CN' | 'JP' | 'GLOBAL' | null;
  note: string | null;
  sourceUrl: string | null;
  series: { slug: string; title: string; coverUrl: string | null } | null;
  category: { slug: string; name: string } | null;
};

type QueryState = {
  data: unknown;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string } | null;
  errorUpdateCount: number;
  dataUpdatedAt: number;
  refetch: () => void;
};

const INJECTED = 'QA-INJECTED-xyz';

const harness = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    version: () => version,
    emit() {
      version += 1;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    seriesInputs: [] as Array<Record<string, unknown> | undefined>,
    releaseInputs: [] as Array<{ from: string; to: string }>,
  };
});

function useBus() {
  useSyncExternalStore(harness.subscribe, harness.version, harness.version);
}

function queryState(data: unknown): QueryState {
  return {
    data,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    errorUpdateCount: 0,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  };
}

const heroState = queryState({ items: [] });
const latestState = queryState({ items: [] });
const categoriesState = queryState({ items: [] });
const releasesState = queryState({ absent: true, items: [] });

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isPending: false,
          isError: false,
          errorUpdateCount: 0,
          dataUpdatedAt: 0,
        }),
      },
    },
    series: {
      list: {
        useQuery: (input?: Record<string, unknown>) => {
          useBus();
          harness.seriesInputs.push(input);
          return typeof input?.releasedOnOrBefore === 'string' ? heroState : latestState;
        },
      },
    },
    categories: {
      list: {
        useQuery: () => {
          useBus();
          return categoriesState;
        },
      },
    },
  },
}));

vi.mock('../lib/releases-list', () => ({
  useReleasesList: (input: { from: string; to: string }) => {
    useBus();
    harness.releaseInputs.push(input);
    return releasesState;
  },
}));

import { HomePage } from './home';

function renderHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

function series(
  partial: Partial<SeriesFixture> & Pick<SeriesFixture, 'slug' | 'title'>,
): SeriesFixture {
  return {
    description: '简介',
    coverUrl: null,
    cardCount: 2,
    releaseDate: '2024-03-15',
    ...partial,
  };
}

function fail(state: QueryState) {
  state.data = undefined;
  state.isLoading = false;
  state.isPending = false;
  state.isFetching = false;
  state.isError = true;
  state.error = { message: INJECTED };
  state.errorUpdateCount = 1;
  state.dataUpdatedAt = 0;
}

function loading(state: QueryState) {
  state.data = undefined;
  state.isLoading = true;
  state.isPending = true;
  state.isFetching = true;
  state.isError = false;
  state.error = null;
  state.errorUpdateCount = 0;
  state.dataUpdatedAt = 0;
}

function ready(state: QueryState, data: unknown) {
  state.data = data;
  state.isLoading = false;
  state.isPending = false;
  state.isFetching = false;
  state.isError = false;
  state.error = null;
  state.errorUpdateCount = 0;
  state.dataUpdatedAt = 1;
  state.refetch = vi.fn();
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  harness.seriesInputs.length = 0;
  harness.releaseInputs.length = 0;
  ready(heroState, { items: [] });
  ready(latestState, { items: [] });
  ready(categoriesState, { items: [] });
  ready(releasesState, { absent: true, items: [] });
});

describe('home hero', () => {
  it('features the series released on or before today and keeps a future series out of the hero', () => {
    const past = series({
      slug: 'past-set',
      title: '已经发售',
      releaseDate: '2024-03-15',
      cardCount: 1,
    });
    const tomorrow = series({
      slug: 'tomorrow-set',
      title: '明天发售',
      releaseDate: '2099-01-02',
      cardCount: 3,
    });
    ready(heroState, { items: [past] });
    ready(latestState, { items: [tomorrow, past] });
    renderHome();

    expect(harness.seriesInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sort: 'releaseDateDesc',
          releasedOnOrBefore: shanghaiToday(),
          pageSize: 1,
        }),
        expect.objectContaining({ sort: 'createdAtDesc', pageSize: 9 }),
      ]),
    );
    const hero = screen.getByRole('heading', { level: 2, name: '已经发售' }).closest('a');
    expect(hero).toHaveAttribute('href', '/series/past-set');
    expect(hero).toHaveTextContent('最近发售');
    expect(hero).toHaveTextContent('1 张卡牌');
    expect(screen.queryByRole('heading', { level: 2, name: '明天发售' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '明天发售' })).toBeInTheDocument();
    expect(screen.queryByText('系列总览')).not.toBeInTheDocument();
    expect(screen.queryByText('已索引卡牌')).not.toBeInTheDocument();
  });

  it('labels the newest series when nothing has been released yet', () => {
    const added = series({ slug: 'new-set', title: '刚收录', releaseDate: null, cardCount: 4 });
    ready(heroState, { items: [] });
    ready(latestState, { items: [added] });
    renderHome();

    const hero = screen.getByRole('heading', { level: 2, name: '刚收录' }).closest('a');
    expect(hero).toHaveTextContent('最新收录');
    expect(hero).not.toHaveTextContent('最近发售');
    expect(screen.queryByRole('heading', { name: '最新收录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^全部系列/ })).not.toBeInTheDocument();
  });

  it('keeps the hero copy when the catalog is empty', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: '欢迎来到 Cardhub' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '浏览全部系列' })).toHaveAttribute('href', '/series');
    expect(screen.getByRole('link', { name: '搜索卡牌' })).toHaveAttribute('href', '/search');
  });

  it('shows the hero failure without the server message and keeps the actions', () => {
    fail(heroState);
    ready(categoriesState, {
      items: [{ slug: 'deck', name: '构筑对战', description: '套牌', seriesCount: 2 }],
    });
    renderHome();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('主推系列加载失败');
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(screen.getByRole('link', { name: '浏览全部系列' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /构筑对战/ })).toBeInTheDocument();
  });
});

describe('home sections', () => {
  it('shows at most eight categories and the all-categories link only past that', () => {
    const items: CategoryFixture[] = Array.from({ length: 9 }, (_, index) => ({
      slug: `cat-${index}`,
      name: `分类${index}`,
      description: `说明${index}`,
      seriesCount: index === 0 ? 0 : index,
    }));
    ready(categoriesState, { items });
    renderHome();

    expect(screen.getByRole('link', { name: /分类0/ })).toHaveAttribute(
      'href',
      '/categories/cat-0',
    );
    expect(screen.getByRole('link', { name: /分类0/ })).toHaveTextContent('0 个系列');
    expect(screen.getByText('说明0')).toHaveClass('hidden', 'lg:line-clamp-2');
    expect(screen.queryByRole('link', { name: /分类8/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /全部分类/ })).toHaveAttribute('href', '/categories');
    const grid = screen.getByRole('link', { name: /分类0/ }).closest('ul');
    expect(grid).toHaveClass('grid-cols-2', 'lg:grid-cols-4');
  });

  it('omits the category block when the list is empty', () => {
    renderHome();
    expect(screen.queryByRole('heading', { name: '分类' })).not.toBeInTheDocument();
  });

  it('scrolls the newest series on small screens and links to every series', () => {
    const past = series({ slug: 'past-set', title: '已经发售' });
    const rest = Array.from({ length: 9 }, (_, index) =>
      series({ slug: `extra-${index}`, title: `收录${index}`, releaseDate: null }),
    );
    ready(heroState, { items: [past] });
    ready(latestState, { items: [past, ...rest] });
    renderHome();

    const list = screen.getByRole('heading', { level: 3, name: '收录0' }).closest('ul');
    expect(list).toHaveClass('flex', 'overflow-x-auto', 'snap-x', 'md:grid', 'lg:grid-cols-4');
    expect(list?.querySelector('li')).toHaveClass('w-64', 'snap-start');
    expect(screen.queryByRole('heading', { level: 3, name: '已经发售' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '收录7' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: '收录8' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^全部系列/ })).toHaveAttribute('href', '/series');
    const card = screen.getByRole('link', { name: /收录0/ });
    expect(card).toHaveClass('hover:-translate-y-0.5', 'motion-reduce:hover:translate-y-0');
  });

  it('hides upcoming releases when the procedure is missing or empty', () => {
    ready(releasesState, { absent: true, items: [] });
    renderHome();
    expect(screen.queryByRole('heading', { name: '即将发售' })).not.toBeInTheDocument();

    act(() => {
      ready(releasesState, { absent: false, items: [] });
      harness.emit();
    });
    expect(screen.queryByRole('heading', { name: '即将发售' })).not.toBeInTheDocument();
  });

  it('shows three upcoming releases and the calendar link', () => {
    const releases: ReleaseFixture[] = Array.from({ length: 4 }, (_, index) => ({
      id: `rel-${index}`,
      title: `发售${index}`,
      releaseDate: `2026-11-0${index + 1}`,
      region: 'CN',
      note: null,
      sourceUrl: null,
      series: { slug: `set-${index}`, title: `系列${index}`, coverUrl: null },
      category: { slug: 'deck', name: '构筑' },
    }));
    ready(releasesState, { absent: false, items: releases });
    renderHome();

    expect(harness.releaseInputs[0]).toEqual({
      from: shanghaiToday(),
      to: addCalendarDays(shanghaiToday(), 365),
    });
    expect(screen.getByRole('heading', { level: 2, name: '即将发售' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /发售日历/ })).toHaveAttribute('href', '/calendar');
    expect(screen.getByRole('heading', { level: 3, name: '发售0' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '发售2' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '发售3' })).not.toBeInTheDocument();
    const list = screen.getByRole('heading', { level: 3, name: '发售0' }).closest('ul');
    expect(list).toHaveClass('grid', 'md:grid-cols-3');
  });
});

describe('home states', () => {
  it('renders skeletons for hero, categories, and latest, and skips upcoming while loading', () => {
    loading(heroState);
    loading(latestState);
    loading(categoriesState);
    loading(releasesState);
    renderHome();

    expect(screen.getAllByText('加载中').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('heading', { name: '分类' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '最新收录' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '即将发售' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(document.querySelector('.aspect-2\\/1')).toHaveClass(
      'animate-pulse',
      'motion-reduce:animate-none',
    );
  });

  it('limits a category failure to that block and restores focus after retry', async () => {
    const user = userEvent.setup();
    const past = series({ slug: 'past-set', title: '已经发售' });
    ready(heroState, { items: [past] });
    ready(latestState, { items: [past, series({ slug: 'other', title: '另一系列' })] });
    fail(categoriesState);
    categoriesState.refetch = () => {
      ready(categoriesState, {
        items: [{ slug: 'deck', name: '构筑对战', description: null, seriesCount: 1 }],
      });
      harness.emit();
    };
    renderHome();

    expect(screen.getByRole('alert')).toHaveTextContent('分类加载失败');
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(screen.getByRole('heading', { level: 2, name: '已经发售' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '即将发售' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(document.activeElement).toHaveAttribute('id', 'home-categories-panel');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /构筑对战/ })).toBeInTheDocument();
  });

  it('shows the upcoming error without hiding the rest of the page', () => {
    fail(releasesState);
    ready(heroState, { items: [series({ slug: 'past-set', title: '已经发售' })] });
    renderHome();

    expect(screen.getByRole('alert')).toHaveTextContent('即将发售加载失败');
    expect(document.body.textContent).not.toContain(INJECTED);
    expect(screen.getByRole('heading', { level: 1, name: '欢迎来到 Cardhub' })).toBeInTheDocument();
  });

  it('uses the English failure and card-count copy', () => {
    rootStore.locale.setLocale('en-US');
    fail(heroState);
    fail(categoriesState);
    fail(latestState);
    fail(releasesState);
    renderHome();

    expect(screen.getByText("Couldn't load the featured series.")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load categories.")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load new series.")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load upcoming releases.")).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });
});

describe('home chrome', () => {
  it('publishes one homepage description in the current language', () => {
    renderHome();
    const descriptions = document.querySelectorAll('meta[name="description"]');
    expect(descriptions).toHaveLength(1);
    expect(descriptions[0]).toHaveAttribute('content', t('zh-CN', 'meta.home'));

    act(() => {
      rootStore.locale.setLocale('en-US');
    });
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      t('en-US', 'meta.home'),
    );
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
  });

  it('switches the page copy from the footer and keeps the footer links on real pages', async () => {
    const user = userEvent.setup();
    renderHome();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('navigation', { name: '页脚' })).toBeInTheDocument();
    expect(footer).toHaveTextContent('Cardhub 是非官方资料站，与卡牌发行商无关。');
    expect(footer).toHaveTextContent(
      'Cardhub 不参与交易、不担保资金安全，请通过站外联系并自行核实。',
    );
    expect(within(footer).getByRole('link', { name: '分类' })).toHaveAttribute(
      'href',
      '/categories',
    );
    expect(within(footer).getByRole('link', { name: '系列' })).toHaveAttribute('href', '/series');
    expect(within(footer).getByRole('link', { name: '论坛' })).toHaveAttribute('href', '/forum');
    expect(within(footer).getByRole('link', { name: '交易' })).toHaveAttribute('href', '/trade');
    expect(within(footer).queryByRole('link', { name: '发售日历' })).not.toBeInTheDocument();

    const localeButton = within(footer).getByRole('button', { name: 'English' });
    expect(localeButton).toHaveAttribute('lang', 'en');
    await user.click(localeButton);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Welcome to Cardhub' }),
    ).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: '中文' })).toHaveAttribute('lang', 'zh');
    expect(footer).toHaveTextContent(
      'Cardhub is an unofficial fan site, not affiliated with any card publisher.',
    );
  });
});
