import { observer } from 'mobx-react-lite';
import { Link, useParams } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { RarityBadge } from '../components/rarity-badge';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { CommentSection } from '../components/comment-section';
import { ListingsForCard } from '../components/listings-for-card';
import { Artwork } from '../components/artwork';

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'] as const;
function normalizeRarity(rarity: string | null): (typeof RARITY_ORDER)[number] {
  if (rarity && (RARITY_ORDER as readonly string[]).includes(rarity)) {
    return rarity as (typeof RARITY_ORDER)[number];
  }
  return 'common';
}

export const CardDetailPage = observer(function CardDetailPage() {
  const { cardSlug = '' } = useParams<{ cardSlug: string }>();
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const query = trpc.cards.bySlug.useQuery({ slug: cardSlug }, { enabled: !!cardSlug });

  if (query.isLoading) {
    return (
      <PageShell>
        <div className="grid gap-8 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="aspect-[63/88] animate-pulse rounded-3xl bg-neutral-200" />
          <div className="space-y-4">
            <div className="h-8 w-2/3 animate-pulse rounded bg-neutral-200" />
            <div className="h-4 w-full animate-pulse rounded bg-neutral-200" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-200" />
            <div className="h-32 animate-pulse rounded-2xl bg-white/60" />
          </div>
        </div>
      </PageShell>
    );
  }

  if (query.isError || !query.data) {
    const isNotFound = query.error?.data?.code === 'NOT_FOUND';
    return (
      <PageShell>
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('breadcrumb.cards'), to: '/series' },
              { label: cardSlug },
            ]}
          />
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {isNotFound ? tt('state.notFound') : (query.error?.message ?? tt('state.error'))}
          </p>
        </div>
      </PageShell>
    );
  }

  const card = query.data;
  const attributes = card.attributes ?? {};

  return (
    <PageShell>
      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('breadcrumb.series'), to: '/series' },
            { label: card.seriesTitle, to: `/series/${card.seriesSlug}` },
            { label: card.name },
          ]}
        />

        <div className="grid gap-8 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Artwork
            kind="card"
            src={card.imageUrl}
            slug={card.slug}
            name={card.name}
            fit="contain"
            priority
            placeholderInitial="bottom-left"
            className="rounded-3xl border border-white/60 shadow-xl"
          />

          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight">{card.name}</h1>
                <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
              </div>
              <p className="text-neutral-600">{card.description}</p>
              <p className="text-sm text-neutral-500">
                {tt('card.detail.seriesLabel')}
                <Link to={`/series/${card.seriesSlug}`} className="text-brand-600 hover:underline">
                  {card.seriesTitle}
                </Link>
              </p>
            </div>

            <Card className="border-white/60 bg-white/70 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">{tt('card.detail.attributes')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-4">
                  {Object.entries(attributes).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <dt className="text-xs uppercase tracking-widest text-neutral-500">{key}</dt>
                      <dd className="font-mono text-base text-neutral-900">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card className="border-white/60 bg-white/70 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">{tt('trade.detail.byCardTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ListingsForCard cardSlug={card.slug} />
              </CardContent>
            </Card>

            <Card className="border-white/60 bg-white/70 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-base">{tt('card.detail.commentsTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <CommentSection cardSlug={card.slug} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageShell>
  );
});
