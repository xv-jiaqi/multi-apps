import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

type SeriesFixture = {
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  cardCount: number;
};

const seriesState: {
  data: { items: SeriesFixture[]; total: number } | undefined;
  isLoading: boolean;
} = {
  data: { items: [], total: 0 },
  isLoading: false,
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
    },
    series: {
      list: {
        useQuery: () => seriesState,
      },
    },
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

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  seriesState.isLoading = false;
  seriesState.data = { items: [], total: 0 };
});

describe('FeaturedSeriesTile contrast', () => {
  it('keeps the cover opacity fixed while hovered and darkens the description', async () => {
    const user = userEvent.setup();
    seriesState.data = {
      total: 2,
      items: [
        {
          slug: 'black-cover',
          title: '纯黑封面',
          description: '黑底说明',
          coverUrl: 'https://example.invalid/black.png',
          cardCount: 1,
        },
        {
          slug: 'forge-of-titans',
          title: '泰坦熔炉',
          description: '机械与火焰',
          coverUrl: 'gradient:from-orange-500-via-red-500-to-rose-700',
          cardCount: 2,
        },
      ],
    };

    renderHome();

    const titan = screen.getByRole('link', { name: /泰坦熔炉/ });
    await user.hover(titan);
    const titanCover = titan.firstElementChild;
    expect(titanCover).toHaveClass('opacity-30');
    expect(titanCover?.className ?? '').not.toMatch(/opacity-50/);
    expect(titan).toHaveClass('hover:-translate-y-1');
    expect(screen.getByText('机械与火焰')).toHaveClass('text-neutral-800');

    const black = screen.getByRole('link', { name: /纯黑封面/ });
    await user.hover(black);
    const blackCover = black.firstElementChild;
    expect(blackCover).toHaveClass('opacity-30');
    expect(blackCover?.className ?? '').not.toMatch(/opacity-50/);
    expect(screen.getByText('黑底说明')).toHaveClass('text-neutral-800');
  });
});
