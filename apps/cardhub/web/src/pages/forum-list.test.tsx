import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';
import { ForumListPage } from './forum-list';

vi.mock('../lib/trpc', () => ({
  trpc: {
    forum: {
      topics: {
        list: {
          useInfiniteQuery: () => ({
            data: { pages: [{ items: [], nextCursor: null }] },
            isLoading: false,
            isError: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            refetch: vi.fn(),
            fetchNextPage: vi.fn(),
          }),
        },
      },
    },
  },
}));

function LocationStateProbe() {
  const location = useLocation();
  return (
    <output role="none" aria-label="location-state">
      {JSON.stringify(location.state)}
    </output>
  );
}

describe('ForumListPage topic deletion notice', () => {
  it('shows a focused status notice and clears router state', async () => {
    rootStore.session.signOut();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/forum', state: { notice: 'topicDeleted' } }]}>
        <Routes>
          <Route
            path="/forum"
            element={
              <>
                <ForumListPage />
                <LocationStateProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const notice = await screen.findByText('话题已删除');
    expect(notice).toHaveTextContent('话题已删除');
    expect(notice).toHaveFocus();

    await waitFor(() => {
      expect(screen.getByLabelText('location-state')).toHaveTextContent('null');
    });
  });
});
