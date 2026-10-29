import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useParams,
} from 'react-router';
import { rootStore } from './stores/root-store';
import { ErrorBoundary } from './components/error-boundary';
import { LazyRoute } from './app';

vi.mock('./lib/trpc', () => ({
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
  },
}));

function Boom(): never {
  throw new Error('Failed to fetch dynamically imported module: /assets/series-detail.js');
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('route error shell', () => {
  it('shows the site header on a lazy route crash and not on the root boundary', () => {
    render(
      <MemoryRouter initialEntries={['/series/celestial-dawn']}>
        <Routes>
          <Route
            path="/series/:seriesSlug"
            element={
              <LazyRoute name="/series/:seriesSlug">
                <Boom />
              </LazyRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('页面出错了');
    expect(screen.getByRole('link', { name: '跳到主内容' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '系列' })).toBeInTheDocument();
    expect(screen.getByRole('alert').parentElement).toHaveAttribute('id', 'main');
  });

  it('resets the boundary after leaving through the header', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/series/celestial-dawn']}>
        <Routes>
          <Route
            path="/series/:seriesSlug"
            element={
              <LazyRoute name="/series/:seriesSlug">
                <Boom />
              </LazyRoute>
            }
          />
          <Route path="/series" element={<p>series index</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole('link', { name: '系列' })[0]!);
    expect(await screen.findByText('series index')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stays on the error when only the search or hash changes', async () => {
    function Page() {
      const { seriesSlug } = useParams();
      if (seriesSlug === 'celestial-dawn') {
        throw new Error('Failed to fetch dynamically imported module: /assets/series-detail.js');
      }
      return <p>loaded {seriesSlug}</p>;
    }

    const router = createMemoryRouter(
      [
        {
          path: '/series/:seriesSlug',
          element: (
            <LazyRoute name="/series/:seriesSlug">
              <Page />
            </LazyRoute>
          ),
        },
      ],
      { initialEntries: ['/series/celestial-dawn'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/series/celestial-dawn?q=1');
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/series/celestial-dawn#comments');
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('loaded celestial-dawn')).not.toBeInTheDocument();
  });

  it('resets the same route when the pathname changes', async () => {
    function Page() {
      const { seriesSlug } = useParams();
      if (seriesSlug === 'celestial-dawn') {
        throw new Error('Failed to fetch dynamically imported module: /assets/series-detail.js');
      }
      return <p>loaded {seriesSlug}</p>;
    }

    const router = createMemoryRouter(
      [
        {
          path: '/series/:seriesSlug',
          element: (
            <LazyRoute name="/series/:seriesSlug">
              <Page />
            </LazyRoute>
          ),
        },
      ],
      { initialEntries: ['/series/celestial-dawn'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await act(async () => {
      await router.navigate('/series/verdant-rift');
    });
    expect(screen.getByText('loaded verdant-rift')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

afterEach(() => {
  cleanup();
});

describe('root error boundary', () => {
  it('keeps the crash box without the site header', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('页面出错了');
    expect(screen.queryByRole('link', { name: '跳到主内容' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert').closest('.app-safe-x')).not.toBeNull();
  });
});
