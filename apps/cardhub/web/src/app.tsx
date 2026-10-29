import { lazy, Suspense } from 'react';
import { Outlet, useLocation, type RouteObject } from 'react-router';
import { AuthBootstrap } from './components/auth-bootstrap';
import { SessionExpiryWatcher } from './components/session-expiry-watcher';
import { ErrorBoundary, isChunkLoadError } from './components/error-boundary';
import { CardDetailSkeleton } from './components/card-detail-skeleton';
import { RouteErrorFallback } from './components/route-error';
import { captureSentryException } from './lib/sentry';
import { HomePage } from './pages/home';

const CategoryListPage = lazy(() =>
  import('./pages/category-list').then((m) => ({ default: m.CategoryListPage })),
);
const CategoryDetailPage = lazy(() =>
  import('./pages/category-detail').then((m) => ({ default: m.CategoryDetailPage })),
);
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
const CatalogCategoriesPage = lazy(() =>
  import('./pages/admin/catalog-categories').then((m) => ({ default: m.CatalogCategoriesPage })),
);
const NewCategoryPage = lazy(() =>
  import('./pages/admin/category-form-page').then((m) => ({ default: m.NewCategoryPage })),
);
const EditCategoryPage = lazy(() =>
  import('./pages/admin/category-form-page').then((m) => ({ default: m.EditCategoryPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/admin/users').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminAuditPage = lazy(() =>
  import('./pages/admin/audit').then((m) => ({ default: m.AdminAuditPage })),
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
const ChangePasswordPage = lazy(() =>
  import('./pages/me-password').then((m) => ({ default: m.ChangePasswordPage })),
);

function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[40vh] max-w-2xl items-center justify-center text-sm text-neutral-500"
    >
      <span className="inline-block h-4 w-4 animate-pulse motion-reduce:animate-none rounded-full bg-neutral-400" />
    </div>
  );
}

export function LazyRoute({
  name,
  fallback = <RouteFallback />,
  children,
}: {
  name: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const location = useLocation();
  // Per-route ErrorBoundary so a single page crash doesn't kill the shell.
  // Reset only after an error when the pathname changes. Search params and
  // hashes keep the page mounted so focus and local state survive.
  return (
    <ErrorBoundary
      pathname={location.pathname}
      withShell
      onError={(error) => {
        if (!isChunkLoadError(error)) return;
        captureSentryException(error, undefined, { route: name });
      }}
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function AppLayout() {
  return (
    <>
      <AuthBootstrap />
      <SessionExpiryWatcher />
      <Outlet />
    </>
  );
}

function lazyPage(
  name: string,
  page: React.ReactNode,
  fallback?: React.ReactNode,
): React.ReactNode {
  return (
    <LazyRoute name={name} fallback={fallback}>
      {page}
    </LazyRoute>
  );
}

export const appRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/categories', element: lazyPage('/categories', <CategoryListPage />) },
      {
        path: '/categories/:slug',
        element: lazyPage('/categories/:slug', <CategoryDetailPage />),
      },
      { path: '/series', element: lazyPage('/series', <SeriesListPage />) },
      {
        path: '/series/:seriesSlug',
        element: lazyPage('/series/:seriesSlug', <SeriesDetailPage />),
      },
      {
        path: '/cards/:cardSlug',
        element: lazyPage('/cards/:cardSlug', <CardDetailPage />, <CardDetailSkeleton />),
      },
      { path: '/search', element: lazyPage('/search', <SearchPage />) },
      { path: '/login', element: lazyPage('/login', <LoginPage />) },
      { path: '/register', element: lazyPage('/register', <RegisterPage />) },
      { path: '/forum', element: lazyPage('/forum', <ForumListPage />) },
      { path: '/forum/new', element: lazyPage('/forum/new', <ForumNewPage />) },
      { path: '/forum/:slug/edit', element: lazyPage('/forum/:slug/edit', <ForumEditPage />) },
      { path: '/forum/:slug', element: lazyPage('/forum/:slug', <ForumDetailPage />) },
      { path: '/trade', element: lazyPage('/trade', <TradeListPage />) },
      { path: '/trade/new', element: lazyPage('/trade/new', <TradePublishPage />) },
      { path: '/reports', element: lazyPage('/reports', <ReportsListPage />) },
      { path: '/admin/catalog', element: lazyPage('/admin/catalog', <CatalogSeriesPage />) },
      {
        path: '/admin/catalog/categories/new',
        element: lazyPage('/admin/catalog/categories/new', <NewCategoryPage />),
      },
      {
        path: '/admin/catalog/categories/:slug/edit',
        element: lazyPage('/admin/catalog/categories/:slug/edit', <EditCategoryPage />),
      },
      {
        path: '/admin/catalog/categories',
        element: lazyPage('/admin/catalog/categories', <CatalogCategoriesPage />),
      },
      { path: '/admin/users', element: lazyPage('/admin/users', <AdminUsersPage />) },
      { path: '/admin/audit', element: lazyPage('/admin/audit', <AdminAuditPage />) },
      {
        path: '/admin/catalog/import',
        element: lazyPage('/admin/catalog/import', <CatalogImportPage />),
      },
      {
        path: '/admin/catalog/series/new',
        element: lazyPage('/admin/catalog/series/new', <NewSeriesPage />),
      },
      {
        path: '/admin/catalog/series/:slug/edit',
        element: lazyPage('/admin/catalog/series/:slug/edit', <EditSeriesPage />),
      },
      {
        path: '/admin/catalog/series/:slug/cards/new',
        element: lazyPage('/admin/catalog/series/:slug/cards/new', <NewCardPage />),
      },
      {
        path: '/admin/catalog/series/:slug',
        element: lazyPage('/admin/catalog/series/:slug', <CatalogSeriesDetailPage />),
      },
      {
        path: '/admin/catalog/cards/:slug/edit',
        element: lazyPage('/admin/catalog/cards/:slug/edit', <EditCardPage />),
      },
      { path: '/me/password', element: lazyPage('/me/password', <ChangePasswordPage />) },
      { path: '/me', element: lazyPage('/me', <MePage />) },
      { path: '*', element: lazyPage('*', <NotFoundPage />) },
    ],
  },
];
