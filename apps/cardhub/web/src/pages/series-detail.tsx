import { useLayoutEffect, useRef, type Ref } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useParams } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { isAppErrorCode, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { RarityBadge } from '../components/rarity-badge';
import { CommentSection } from '../components/comment-section';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { ART_ASPECT, ART_SURFACE, useArtImage } from '../components/artwork';
import { cn } from '@repo/ui-web';
import { gradientFor } from '../lib/gradients';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'] as const;
function normalizeRarity(rarity: string | null): (typeof RARITY_ORDER)[number] {
  if (rarity && (RARITY_ORDER as readonly string[]).includes(rarity)) {
    return rarity as (typeof RARITY_ORDER)[number];
  }
  return 'common';
}

type SeriesHeroProps = {
  series: { slug: string; title: string; description: string | null; coverUrl: string | null };
  alt: string;
  cardCountLabel: string;
  headingRef: Ref<HTMLHeadingElement>;
};

function SeriesHero({ series, alt, cardCountLabel, headingRef }: SeriesHeroProps) {
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
      <div
        className={cn('absolute inset-0', hasImage ? 'bg-black/65' : 'bg-black/15')}
        aria-hidden
      />
      <div className="relative space-y-3">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-white md:text-4xl"
        >
          {series.title}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-white/90">
          {series.description ?? ''}
        </p>
        <p className="text-xs uppercase tracking-widest text-white/80">{cardCountLabel}</p>
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

type SeriesCardArtProps = {
  card: { slug: string; name: string; imageUrl: string | null };
};

function SeriesCardArt({ card }: SeriesCardArtProps) {
  const art = useArtImage({
    src: card.imageUrl,
    alt: '',
    fit: 'cover',
    className: 'absolute inset-0',
  });
  const hasImage = art.mode === 'image';

  return (
    <div
      className={cn(
        'relative flex h-44 items-center justify-center bg-gradient-to-br',
        gradientFor(card.slug),
        hasImage && 'py-3',
      )}
      aria-hidden
    >
      {hasImage ? (
        <div
          className={cn(
            'relative h-full overflow-hidden rounded-md shadow-md',
            ART_ASPECT.card,
            ART_SURFACE,
            'ring-1 ring-black/10',
          )}
        >
          <img key={card.imageUrl ?? card.slug} {...art.imgProps} />
        </div>
      ) : (
        <span className="text-3xl font-black uppercase tracking-widest text-white/70">
          {card.name.slice(0, 1)}
        </span>
      )}
    </div>
  );
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
      <PageMeta title={series.title} />
      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('breadcrumb.series'), to: '/series' },
            { label: series.title },
          ]}
        />

        <SeriesHero
          series={series}
          alt={tt('artwork.seriesAlt', { title: series.title })}
          cardCountLabel={tt('series.cardCount', { count: series.cards.length })}
          headingRef={headingRef}
        />

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{tt('series.detail.cardsTitle')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {series.cards.map((card) => (
              <li key={card.slug}>
                <Link
                  to={`/cards/${card.slug}`}
                  className="group block overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 hover:shadow-md"
                >
                  <SeriesCardArt card={card} />
                  <div className="flex items-center justify-between p-4">
                    <span className="text-base font-semibold text-neutral-900">{card.name}</span>
                    <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <Card className="border-white/60 bg-white/70 backdrop-blur">
          <CardHeader>
            <CardTitle
              id="comment-section-title"
              tabIndex={-1}
              className="scroll-mt-20 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {tt('series.detail.commentsTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CommentSection target={{ kind: 'series', slug: series.slug }} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
