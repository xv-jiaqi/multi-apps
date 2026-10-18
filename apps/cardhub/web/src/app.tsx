import { lazy, Suspense } from 'react';
import { Outlet, type RouteObject } from 'react-router';
import { AuthBootstrap } from './components/auth-bootstrap';
import { ErrorBoundary } from './components/error-boundary';
import { HomePage } from './pages/home';

const SeriesListPage = lazy(() =>
  import('./pages/series-list').then((m) => ({ default: m.SeriesListPage })),
);
const SeriesDetailPage = lazy(() =>
  import('./pages/series-detail').then((m) => ({ default: m.SeriesDetailPage })),
);
const CardDetailPage = lazy(() =>
  import('./pages/card-detail').then((m) => ({ default: m.CardDetailPage })),
);
const SearchPage = lazy(() => import('./pages/search').then((m) => ({ default: m.SearchPage })));
const LoginPage = lazy(() => import('./pages/login').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('./pages/register').then((m) => ({ default: m.RegisterPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/not-found').then((m) => ({ default: m.NotFoundPage })),
);
const ForumListPage = lazy(() =>
  import('./pages/forum-list').then((m) => ({ default: m.ForumListPage })),
);
const ForumNewPage = lazy(() =>
  import('./pages/forum-new').then((m) => ({ default: m.ForumNewPage })),
);
const ForumEditPage = lazy(() =>
  import('./pages/forum-edit').then((m) => ({ default: m.ForumEditPage })),
);
const ForumDetailPage = lazy(() =>
  import('./pages/forum-detail').then((m) => ({ default: m.ForumDetailPage })),
);
const TradeListPage = lazy(() =>
  import('./pages/trade-list').then((m) => ({ default: m.TradeListPage })),
);
const TradePublishPage = lazy(() =>
  import('./pages/trade-publish').then((m) => ({ default: m.TradePublishPage })),
);
const ReportsListPage = lazy(() =>
  import('./pages/reports-list').then((m) => ({ default: m.ReportsListPage })),
);
const CatalogSeriesPage = lazy(() =>
  import('./pages/admin/catalog-series').then((m) => ({ default: m.CatalogSeriesPage })),
);
const CatalogSeriesDetailPage = lazy(() =>
  import('./pages/admin/catalog-series-detail').then((m) => ({
    default: m.CatalogSeriesDetailPage,
  })),
);
const NewSeriesPage = lazy(() =>
  import('./pages/admin/series-form-page').then((m) => ({ default: m.NewSeriesPage })),
);
const EditSeriesPage = lazy(() =>
  import('./pages/admin/series-form-page').then((m) => ({ default: m.EditSeriesPage })),
);
const NewCardPage = lazy(() =>
  import('./pages/admin/card-form-page').then((m) => ({ default: m.NewCardPage })),
);
const EditCardPage = lazy(() =>
  import('./pages/admin/card-form-page').then((m) => ({ default: m.EditCardPage })),
);
const CatalogImportPage = lazy(() =>
  import('./pages/admin/catalog-import').then((m) => ({ default: m.CatalogImportPage })),
);
const MePage = lazy(() => import('./pages/me').then((m) => ({ default: m.MePage })));

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[40vh] max-w-2xl items-center justify-center text-sm text-neutral-500"
    >
      <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-neutral-400" />
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  // Per-route ErrorBoundary so a single page crash doesn't kill the shell.
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function AppLayout() {
  return (
    <>
      <AuthBootstrap />
      <Outlet />
    </>
  );
}

function lazyPage(page: React.ReactNode): React.ReactNode {
  return <LazyRoute>{page}</LazyRoute>;
}

export const appRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/series', element: lazyPage(<SeriesListPage />) },
      { path: '/series/:seriesSlug', element: lazyPage(<SeriesDetailPage />) },
      { path: '/cards/:cardSlug', element: lazyPage(<CardDetailPage />) },
      { path: '/search', element: lazyPage(<SearchPage />) },
      { path: '/login', element: lazyPage(<LoginPage />) },
      { path: '/register', element: lazyPage(<RegisterPage />) },
      { path: '/forum', element: lazyPage(<ForumListPage />) },
      { path: '/forum/new', element: lazyPage(<ForumNewPage />) },
      { path: '/forum/:slug/edit', element: lazyPage(<ForumEditPage />) },
      { path: '/forum/:slug', element: lazyPage(<ForumDetailPage />) },
      { path: '/trade', element: lazyPage(<TradeListPage />) },
      { path: '/trade/new', element: lazyPage(<TradePublishPage />) },
      { path: '/reports', element: lazyPage(<ReportsListPage />) },
      { path: '/admin/catalog', element: lazyPage(<CatalogSeriesPage />) },
      { path: '/admin/catalog/import', element: lazyPage(<CatalogImportPage />) },
      { path: '/admin/catalog/series/new', element: lazyPage(<NewSeriesPage />) },
      { path: '/admin/catalog/series/:slug/edit', element: lazyPage(<EditSeriesPage />) },
      { path: '/admin/catalog/series/:slug/cards/new', element: lazyPage(<NewCardPage />) },
      { path: '/admin/catalog/series/:slug', element: lazyPage(<CatalogSeriesDetailPage />) },
      { path: '/admin/catalog/cards/:slug/edit', element: lazyPage(<EditCardPage />) },
      { path: '/me', element: lazyPage(<MePage />) },
      { path: '*', element: lazyPage(<NotFoundPage />) },
    ],
  },
];
