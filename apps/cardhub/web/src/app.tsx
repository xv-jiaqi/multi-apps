import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
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

export function App() {
  return (
    <>
      <AuthBootstrap />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/series"
          element={
            <LazyRoute>
              <SeriesListPage />
            </LazyRoute>
          }
        />
        <Route
          path="/series/:seriesSlug"
          element={
            <LazyRoute>
              <SeriesDetailPage />
            </LazyRoute>
          }
        />
        <Route
          path="/cards/:cardSlug"
          element={
            <LazyRoute>
              <CardDetailPage />
            </LazyRoute>
          }
        />
        <Route
          path="/search"
          element={
            <LazyRoute>
              <SearchPage />
            </LazyRoute>
          }
        />
        <Route
          path="/login"
          element={
            <LazyRoute>
              <LoginPage />
            </LazyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <LazyRoute>
              <RegisterPage />
            </LazyRoute>
          }
        />
        <Route
          path="/forum"
          element={
            <LazyRoute>
              <ForumListPage />
            </LazyRoute>
          }
        />
        <Route
          path="/forum/new"
          element={
            <LazyRoute>
              <ForumNewPage />
            </LazyRoute>
          }
        />
        <Route
          path="/forum/:slug/edit"
          element={
            <LazyRoute>
              <ForumEditPage />
            </LazyRoute>
          }
        />
        <Route
          path="/forum/:slug"
          element={
            <LazyRoute>
              <ForumDetailPage />
            </LazyRoute>
          }
        />
        <Route
          path="/trade"
          element={
            <LazyRoute>
              <TradeListPage />
            </LazyRoute>
          }
        />
        <Route
          path="/trade/new"
          element={
            <LazyRoute>
              <TradePublishPage />
            </LazyRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <LazyRoute>
              <ReportsListPage />
            </LazyRoute>
          }
        />
        <Route
          path="/admin/catalog"
          element={
            <LazyRoute>
              <CatalogSeriesPage />
            </LazyRoute>
          }
        />
        <Route
          path="/admin/catalog/import"
          element={
            <LazyRoute>
              <CatalogImportPage />
            </LazyRoute>
          }
        />
        <Route
          path="/admin/catalog/series/new"
          element={
            <LazyRoute>
              <NewSeriesPage />
            </LazyRoute>
          }
        />
        <Route
          path="/admin/catalog/series/:slug/edit"
          element={
            <LazyRoute>
              <EditSeriesPage />
            </LazyRoute>
          }
        />
        <Route
          path="/admin/catalog/series/:slug/cards/new"
          element={
            <LazyRoute>
              <NewCardPage />
            </LazyRoute>
          }
        />
        <Route
          path="/admin/catalog/series/:slug"
          element={
            <LazyRoute>
              <CatalogSeriesDetailPage />
            </LazyRoute>
          }
        />
        <Route
          path="/admin/catalog/cards/:slug/edit"
          element={
            <LazyRoute>
              <EditCardPage />
            </LazyRoute>
          }
        />
        <Route
          path="/me"
          element={
            <LazyRoute>
              <MePage />
            </LazyRoute>
          }
        />
        <Route
          path="*"
          element={
            <LazyRoute>
              <NotFoundPage />
            </LazyRoute>
          }
        />
      </Routes>
    </>
  );
}
