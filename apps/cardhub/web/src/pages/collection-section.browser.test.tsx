import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import '../styles/globals.css';

const mock = vi.hoisted(() => ({
  list: {
    data: {
      pages: [
        {
          items: [
            {
              id: '1',
              cardSlug: 'alpha',
              cardName: '阿尔法',
              imageUrl: null,
              seriesSlug: 'dawn',
              seriesTitle: '黎明',
              state: 'owned' as const,
              ownedCount: 1,
              wanted: false,
            },
          ],
          nextCursor: 'next',
        },
      ],
    },
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as { data?: { appCode?: string }; message: string } | null,
    errorUpdateCount: 0,
    dataUpdatedAt: 1,
    hasNextPage: true,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  },
  progress: {
    data: { items: [{ seriesSlug: 'dawn', seriesTitle: '黎明', owned: 1, total: 2 }] },
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as { data?: { appCode?: string }; message: string } | null,
    errorUpdateCount: 0,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  },
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    collection: {
      progress: { useQuery: () => mock.progress },
      list: {
        useInfiniteQuery: () => mock.list,
      },
    },
  },
}));

import { CollectionSection } from './collection-section';

function renderSection() {
  return render(
    <MemoryRouter>
      <CollectionSection />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'u1', username: 'alice', role: 'user' });
  mock.list.isFetchingNextPage = false;
  mock.list.isError = false;
  mock.list.error = null;
  mock.list.errorUpdateCount = 0;
  mock.list.hasNextPage = true;
  mock.list.fetchNextPage.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('CollectionSection load more focus', () => {
  it('keeps focus on load more after the next page fails', async () => {
    const user = userEvent.setup();
    const view = renderSection();
    const more = screen.getByRole('button', { name: '加载更多' });
    await user.click(more);
    expect(mock.list.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(more);

    mock.list.isFetchingNextPage = true;
    view.rerender(
      <MemoryRouter>
        <CollectionSection />
      </MemoryRouter>,
    );
    const busy = screen.getByRole('button', { name: '加载中…' });
    expect(busy).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
    await user.click(busy);
    expect(mock.list.fetchNextPage).toHaveBeenCalledTimes(1);

    mock.list.isFetchingNextPage = false;
    mock.list.isError = true;
    mock.list.error = { data: { appCode: 'INTERNAL_SERVER_ERROR' }, message: 'down' };
    mock.list.errorUpdateCount = 1;
    view.rerender(
      <MemoryRouter>
        <CollectionSection />
      </MemoryRouter>,
    );
    const again = screen.getByRole('button', { name: '加载更多' });
    expect(again).toHaveFocus();
    expect(document.activeElement).toBe(again);
    expect(document.activeElement).not.toBe(document.body);
  });
});
