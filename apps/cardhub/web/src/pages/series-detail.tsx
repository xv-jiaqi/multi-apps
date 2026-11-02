import { useLayoutEffect, useRef, type Ref } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useParams } from 'react-router';
import { Card, CardContent, CardHeader } from '@repo/ui-web';
import { isAppErrorCode, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { seriesMetaDescription } from '../lib/meta-description';
import { CommentSection } from '../components/comment-section';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { useArtImage } from '../components/artwork';
import { cn } from '@repo/ui-web';
import { formatCatalogDate } from '../lib/catalog-taxonomy';
import { gradientFor } from '../lib/gradients';
import { SeriesCardList } from './series-card-list';

function baseCardCount(cards: Array<{ parallelOfId?: string | null }>): number {
  return cards.filter((card) => card.parallelOfId == null).length;
}

type SeriesHeroProps = {
  series: { slug: string; title: string; description: string | null; coverUrl: string | null };
  alt: string;
  cardCountLabel: string;
  headingRef: Ref<HTMLHeadingElement>;
  category?: { slug: string; name: string } | null;
  releaseDate?: { iso: string; label: string } | null;
};

function SeriesHero({
  series,
  alt,
  cardCountLabel,
  headingRef,
  category,
  releaseDate,
}: SeriesHeroProps) {
  const art = useArtImage({
    src: series.coverUrl,
    alt,
    fit: 'cover',
    priority: true,
    className: 'absolute inset-0',
  });
  const hasImage = art.mode === 'image';

  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-3xl border border-white/60 p-8 text-white shadow-lg',
        hasImage ? 'bg-neutral-800' : `bg-gradient-to-br ${gradientFor(series.slug)}`,
      )}
    >
      {hasImage ? <img key={series.coverUrl} {...art.imgProps} /> : null}
      <div className="absolute inset-0 bg-black/65" aria-hidden />
      <div className="relative space-y-3">
        {category ? (
          <Link
            to={`/categories/${category.slug}`}
            className="inline-flex min-h-6 items-center rounded-full bg-white/90 px-2 text-xs font-medium text-neutral-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {category.name}
          </Link>
        ) : null}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-white md:text-4xl"
        >
          {series.title}
        </h1>
        <p className="max-w-2xl min-w-0 text-sm leading-relaxed text-white/90 wrap-anywhere">
          {series.description ?? ''}
        </p>
        <p className="text-xs uppercase tracking-widest text-white/80">{cardCountLabel}</p>
        {releaseDate ? (
          <p className="text-xs text-white/90">
            <time dateTime={releaseDate.iso}>{releaseDate.label}</time>
          </p>
        ) : null}
      </div>
    </header>
  );
}

type SeriesQueryError = { data?: { code?: string; appCode?: string } | null } | null;

/** Red-box copy is fixed. Known codes share one sentence; unknown codes use UNKNOWN. */
function seriesFailureKey(error: SeriesQueryError): string {
  const appCode = error?.data?.appCode;
  const code = error?.data?.code;
  if (appCode === 'UNKNOWN' || code === 'UNKNOWN') return 'error.app.UNKNOWN';
  if (isAppErrorCode(appCode) || isAppErrorCode(code)) return 'error.app.INTERNAL_SERVER_ERROR';
  return 'error.app.UNKNOWN';
}

export const SeriesDetailPage = observer(function SeriesDetailPage() {
  const { seriesSlug = '' } = useParams<{ seriesSlug: string }>();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const query = trpc.series.bySlug.useQuery({ slug: seriesSlug }, { enabled: !!seriesSlug });
  const view = queryFallback(query);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const failureKey = useRef('error.app.UNKNOWN');
  const retryWasBusy = useRef(false);
  useFocusOnRecovery(view, headingRef);
  if (query.error) failureKey.current = seriesFailureKey(query.error);
  const failureText = tt(failureKey.current);

  useLayoutEffect(() => {
    const busy = view === 'error' && query.isFetching;
    const failedRetry = retryWasBusy.current && !busy && view === 'error';
    retryWasBusy.current = busy;
    if (failedRetry) retryRef.current?.focus({ preventScroll: true });
  }, [view, query.isFetching]);

  if (view === 'loading') {
    return (
      <PageShell>
        <PageMeta title={tt('state.loading')} />
        <div className="space-y-6">
          <div className="h-4 w-40 animate-pulse motion-reduce:animate-none rounded bg-neutral-200" />
          <div className="h-48 animate-pulse motion-reduce:animate-none rounded-3xl bg-neutral-200/60" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-64 animate-pulse motion-reduce:animate-none rounded-2xl bg-white/50"
              />
            ))}
          </div>
        </div>
      </PageShell>
    );
  }

  if (view === 'error' && query.error?.data?.code === 'NOT_FOUND') {
    return (
      <PageShell>
        <PageMeta title={seriesSlug} />
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('breadcrumb.series'), to: '/series' },
              { label: seriesSlug },
            ]}
          />
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-600">
            {tt('state.notFound')}
          </p>
        </div>
      </PageShell>
    );
  }

  if (view === 'error' || !query.data) {
    return (
      <PageShell>
        <PageMeta title={failureText} />
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('breadcrumb.series'), to: '/series' },
              { label: seriesSlug },
            ]}
          />
          <ErrorBox
            headingAs="h1"
            title={failureText}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={query.isFetching}
            retry={() => {
              void query.refetch();
            }}
            retryClassName={dataErrorRetryClassName}
            retryRef={retryRef}
          />
        </div>
      </PageShell>
    );
  }

  const series = query.data;

  return (
    <PageShell>
      <PageMeta
        title={series.title}
        description={seriesMetaDescription({
          locale: locale.locale,
          title: series.title,
          cardCount: baseCardCount(series.cards),
          description: series.description,
        })}
      />
      <div className="space-y-8">
        <Breadcrumbs
          items={
            series.category
              ? [
                  { label: tt('breadcrumb.home'), to: '/' },
                  { label: tt('nav.categories'), to: '/categories' },
                  {
                    label: series.category.name,
                    to: `/categories/${series.category.slug}`,
                  },
                  { label: series.title },
                ]
              : [
                  { label: tt('breadcrumb.home'), to: '/' },
                  { label: tt('breadcrumb.series'), to: '/series' },
                  { label: series.title },
                ]
          }
        />

        <SeriesHero
          series={series}
          alt={tt('artwork.seriesAlt', { title: series.title })}
          cardCountLabel={tt('series.cardCount', {
            count: baseCardCount(series.cards),
          })}
          headingRef={headingRef}
          category={series.category}
          releaseDate={
            series.releaseDate
              ? {
                  iso: series.releaseDate,
                  label: tt('series.releaseDate', {
                    date: formatCatalogDate(locale.locale, series.releaseDate),
                  }),
                }
              : null
          }
        />

        <SeriesCardList
          seriesSlug={series.slug}
          subsets={series.subsets ?? []}
          fallbackCardCount={baseCardCount(series.cards)}
        />

        <Card className="border-white/60 bg-white/70 backdrop-blur">
          <CardHeader>
            <h2
              id="comment-section-title"
              tabIndex={-1}
              className="scroll-mt-20 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {tt('series.detail.commentsTitle')}
            </h2>
          </CardHeader>
          <CardContent>
            <CommentSection target={{ kind: 'series', slug: series.slug }} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
