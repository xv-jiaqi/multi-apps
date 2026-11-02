import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useLocation, useParams } from 'react-router';
import { Card, CardContent, CardHeader } from '@repo/ui-web';
import { cardAttributeLabel, printRunLabel, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { cardMetaDescription } from '../lib/meta-description';
import { RarityBadge } from '../components/rarity-badge';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { CardCollectionBar } from '../components/card-collection-bar';
import { CardVariants } from '../components/card-variants';
import { CommentSection } from '../components/comment-section';
import { ListingsForCard } from '../components/listings-for-card';
import { CardArtLightbox } from '../components/card-art-lightbox';
import { CardBody } from '../components/card-body';
import { CardAdjacentNav, cameFromAdjacent } from '../components/card-adjacent-nav';
import { CardDetailSkeleton } from '../components/card-detail-skeleton';
import { dataErrorRetryClassName, ErrorBox } from '../components/error-box';
import { queryFallback, useFocusOnRecovery } from '../components/retry-button';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'] as const;
function normalizeRarity(rarity: string | null): (typeof RARITY_ORDER)[number] {
  if (rarity && (RARITY_ORDER as readonly string[]).includes(rarity)) {
    return rarity as (typeof RARITY_ORDER)[number];
  }
  return 'common';
}

// CH-206 §1: failure-state h1 matches the normal title size.
const failureTitleClass = 'text-2xl font-bold tracking-tight sm:text-3xl';

export const CardDetailPage = observer(function CardDetailPage() {
  const { cardSlug = '' } = useParams<{ cardSlug: string }>();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const location = useLocation();
  // CH-206 §5: the adjacent links pass route state, never a URL parameter.
  const via = cameFromAdjacent(location.state) ? ('adjacent' as const) : undefined;
  const query = trpc.cards.bySlug.useQuery(via ? { slug: cardSlug, via } : { slug: cardSlug }, {
    enabled: !!cardSlug,
  });
  const view = queryFallback(query);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnRecovery(view, headingRef);

  if (view === 'error' && query.error?.data?.code === 'NOT_FOUND') {
    return (
      <PageShell>
        <PageMeta title={cardSlug} />
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('breadcrumb.series'), to: '/series' },
              { label: cardSlug },
            ]}
          />
          <h1 className={failureTitleClass}>{tt('state.notFound')}</h1>
        </div>
      </PageShell>
    );
  }

  const loadFailed = (
    <PageShell>
      <PageMeta title={tt('card.detail.loadFailed')} />
      <div className="space-y-4">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('breadcrumb.series'), to: '/series' },
            { label: cardSlug },
          ]}
        />
        <ErrorBox
          headingAs="h1"
          headingClassName={failureTitleClass}
          title={tt('card.detail.loadFailed')}
          retryLabel={tt('state.retry')}
          retryingLabel={tt('state.retrying')}
          retrying={query.isFetching}
          retry={() => {
            void query.refetch();
          }}
          retryClassName={dataErrorRetryClassName}
        />
      </div>
    </PageShell>
  );

  if (view === 'error') return loadFailed;

  if (view === 'loading') {
    return (
      <>
        <PageMeta title={tt('state.loading')} />
        <CardDetailSkeleton />
      </>
    );
  }

  if (!query.data) return loadFailed;

  const card = query.data;
  const attributes = card.attributes ?? {};

  return (
    <PageShell>
      <PageMeta
        title={card.name}
        description={cardMetaDescription({
          locale: locale.locale,
          name: card.name,
          seriesTitle: card.seriesTitle,
          cardNumber: card.cardNumber,
          description: card.description,
        })}
      />
      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('breadcrumb.series'), to: '/series' },
            { label: card.seriesTitle, to: `/series/${card.seriesSlug}` },
            ...(card.subset
              ? [
                  {
                    label: card.subset.name,
                    to: `/series/${card.seriesSlug}?subset=${encodeURIComponent(card.subset.slug)}`,
                  },
                ]
              : []),
            { label: card.name },
          ]}
        />

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="mx-auto w-full max-w-sm md:max-w-none lg:sticky lg:top-24 lg:col-span-2 lg:self-start">
            <CardArtLightbox
              src={card.imageUrl}
              slug={card.slug}
              name={card.name}
              openLabel={tt('card.lightbox.open', { name: card.name })}
              closeLabel={tt('state.close')}
              failedLabel={tt('card.lightbox.failed')}
            />
          </div>

          <div className="min-w-0 space-y-6 lg:col-span-3">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-2xl font-bold tracking-tight wrap-anywhere focus:outline-none sm:text-3xl focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {card.name}
                </h1>
                <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
              </div>
              {card.cardNumber || card.subset ? (
                <p className="wrap-anywhere text-sm text-neutral-600">
                  {card.cardNumber ? (
                    <span>{tt('card.detail.number', { number: card.cardNumber })}</span>
                  ) : null}
                  {card.cardNumber && card.subset ? <span aria-hidden> · </span> : null}
                  {card.subset ? <span className="wrap-anywhere">{card.subset.name}</span> : null}
                  {card.isParallel && card.parallelName ? (
                    <span>
                      {(card.cardNumber || card.subset ? ' · ' : '') +
                        tt('card.variant.parallel', { name: card.parallelName })}
                    </span>
                  ) : null}
                </p>
              ) : card.isParallel && card.parallelName ? (
                <p className="wrap-anywhere text-sm text-neutral-600">
                  {tt('card.variant.parallel', { name: card.parallelName })}
                </p>
              ) : null}
              <p className="text-sm text-neutral-600">
                {card.printRun == null ? (
                  printRunLabel(locale.locale, null)
                ) : (
                  <>
                    {printRunLabel(locale.locale, card.printRun).replace(`/${card.printRun}`, '')}
                    <span className="font-mono tabular-nums">/{card.printRun}</span>
                  </>
                )}
              </p>
              {card.base ? (
                <p className="text-sm">
                  <Link to={`/cards/${card.base.slug}`} className="text-brand-600 hover:underline">
                    {tt('card.variants.baseLink', { name: card.base.name })}
                  </Link>
                </p>
              ) : null}
              <p className="text-sm text-neutral-600">
                {tt('card.detail.seriesLabel')}
                <Link
                  to={`/series/${card.seriesSlug}`}
                  className="text-brand-600 underline underline-offset-2"
                >
                  {card.seriesTitle}
                </Link>
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <CardCollectionBar cardSlug={card.slug} cardName={card.name} />
            </div>

            <CardBody
              body={card.body}
              description={card.description}
              title={tt('card.detail.bodyTitle')}
              expandLabel={tt('card.detail.bodyExpand')}
              collapseLabel={tt('card.detail.bodyCollapse')}
              newTabLabel={tt('a11y.newTab')}
            />

            <CardVariants locale={locale.locale} variants={card.variants ?? []} />

            <Card className="border-neutral-200 bg-white">
              <CardHeader>
                <h2 className="scroll-mt-24 text-base font-semibold">
                  {tt('card.detail.attributes')}
                </h2>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-4">
                  {Object.entries(attributes).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <dt className="text-xs tracking-widest text-neutral-600">
                        {cardAttributeLabel(locale.locale, key)}
                      </dt>
                      <dd className="font-mono text-base text-neutral-900">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>

        <CardAdjacentNav locale={locale.locale} adjacent={card.adjacent} />

        <Card className="border-neutral-200 bg-white">
          <CardHeader>
            <h2 className="scroll-mt-24 text-base font-semibold">
              {tt('trade.detail.byCardTitle')}
            </h2>
          </CardHeader>
          <CardContent>
            <ListingsForCard cardSlug={card.slug} />
          </CardContent>
        </Card>

        <Card className="border-neutral-200 bg-white">
          <CardHeader>
            <h2
              id="comment-section-title"
              tabIndex={-1}
              className="scroll-mt-24 text-base font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {tt('card.detail.commentsTitle')}
            </h2>
          </CardHeader>
          <CardContent>
            <CommentSection target={{ kind: 'card', slug: card.slug }} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
