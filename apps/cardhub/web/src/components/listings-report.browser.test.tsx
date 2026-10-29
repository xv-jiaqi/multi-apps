import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

declare module 'vitest/browser' {
  interface BrowserCommands {
    setViewport: (width: number, height: number) => Promise<void>;
  }
}

const listing = {
  id: 'listing-1',
  cardSlug: 'aurora-knight',
  kind: 'SELL' as const,
  price: '1.00',
  currency: 'CNY',
  imageUrls: [],
  contact: 'wechat-alice',
  note: null,
  status: 'OPEN' as const,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  seller: { id: 'alice', username: 'alice' },
  condition: null,
  language: null,
  variantNote: null,
};

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
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
    listings: {
      byCard: {
        useQuery: () => ({
          data: [listing],
          isLoading: false,
          isPending: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          error: null,
          errorUpdateCount: 0,
          dataUpdatedAt: 1,
          refetch: vi.fn(),
        }),
      },
    },
    reports: {
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { ListingsForCard } from './listings-for-card';

beforeEach(async () => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'reporter', username: 'bob', role: 'user' });
  await commands.setViewport(375, 900);
});

afterEach(() => {
  cleanup();
  rootStore.session.signOut();
});

describe('listing report form at 375px', () => {
  it('opens below the row without widening the page', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ListingsForCard cardSlug="aurora-knight" />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '举报' }));
    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    const row = form!.closest('li');
    expect(row).toBeTruthy();
    expect(form!.getBoundingClientRect().width).toBeLessThanOrEqual(
      row!.getBoundingClientRect().width,
    );
    expect(screen.getByText('¥1.00')).toBeInTheDocument();
    expect(screen.getByText(/@alice/)).toBeInTheDocument();
    const scrolling = document.scrollingElement;
    expect(scrolling!.scrollWidth).toBeLessThanOrEqual(scrolling!.clientWidth);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });
});
