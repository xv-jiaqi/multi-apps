import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
  useParams,
} from 'react-router';
import { rootStore } from '../stores/root-store';
import { LazyRoute } from '../app';
import { SearchPage } from './search';
import '../styles/globals.css';

vi.mock('../lib/trpc', () => ({
  clearActiveQueryClient: vi.fn(),
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: { query: '', cards: [], series: [] },
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    series: {
      list: {
        useQuery: () => ({
          data: { items: [], total: 0 },
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: true,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

function pageSearch(): HTMLInputElement {
  const input = document.querySelector('main input[type="search"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('missing search input');
  return input;
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('route boundary stays mounted', () => {
  it('keeps /search focus after the debounced query is written', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter initialEntries={['/search']}>
        <Routes>
          <Route
            path="/search"
            element={
              <LazyRoute name="/search">
                <SearchPage />
              </LazyRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const input = pageSearch();
    await user.click(input);
    await user.type(input, '极光');
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(pageSearch()).toBe(input);
    expect(input).toHaveValue('极光');
    expect(document.activeElement).toBe(input);
  });

  it('does not remount when only the hash or search changes', async () => {
    const mounts = { n: 0 };

    function Page() {
      const location = useLocation();
      const [mountId] = useState(() => {
        mounts.n += 1;
        return mounts.n;
      });
      return (
        <p>
          ready {location.pathname} mount {mountId}
        </p>
      );
    }

    const router = createMemoryRouter(
      [
        {
          path: '/stay',
          element: (
            <LazyRoute name="/stay">
              <Page />
            </LazyRoute>
          ),
        },
      ],
      { initialEntries: ['/stay'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText('ready /stay mount 1')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/stay#section');
    });
    expect(screen.getByText('ready /stay mount 1')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/stay?q=1#section');
    });
    expect(screen.getByText('ready /stay mount 1')).toBeInTheDocument();
    expect(mounts.n).toBe(1);
  });

  it('resets after a pathname change and keeps the error across hash and search', async () => {
    function Page() {
      const { id } = useParams();
      if (id === 'broken') throw new Error('broken page');
      return <p>ready {id}</p>;
    }

    const router = createMemoryRouter(
      [
        {
          path: '/item/:id',
          element: (
            <LazyRoute name="/item/:id">
              <Page />
            </LazyRoute>
          ),
        },
      ],
      { initialEntries: ['/item/broken'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('alert')).toHaveTextContent('页面出错了');

    await act(async () => {
      await router.navigate('/item/broken?q=1');
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/item/broken#section');
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/ready/)).not.toBeInTheDocument();

    await act(async () => {
      await router.navigate('/item/ok');
    });
    expect(screen.getByText('ready ok')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
