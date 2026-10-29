import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Search } from 'lucide-react';
import { t } from '@repo/shared';
import { Button, Input } from '@repo/ui-web';
import { ART_ASPECT } from '../../components/artwork';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { CardThumb } from '../../components/card-thumb';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { RarityBadge } from '../../components/rarity-badge';
import { SubsetSection } from '../../components/admin/subset-section';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import {
  AdminConfirmRow,
  AdminEmpty,
  AdminErrorBox,
  AdminStatus,
  AdminTable,
  AdminTableHead,
  AdminTh,
  actionClass,
} from '../../components/admin/admin-table';
import {
  failureText,
  isAccessRevoked,
  type AdminSeriesItem,
} from '../../components/admin/catalog-utils';
import { useAdminNotice } from '../../components/admin/use-admin-notice';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

const COLUMNS = 5;

interface PublicCard {
  id: string;
  slug: string;
  name: string;
  rarity: string;
  imageUrl: string | null;
}

export const CatalogSeriesDetailPage = observer(function CatalogSeriesDetailPage() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  return (
    <PageShell>
      <PageMeta title={tt('nav.catalog')} />
      <div className="space-y-6">
        <AdminGate>
          <CatalogSeriesDetailBody />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const CatalogSeriesDetailBody = observer(function CatalogSeriesDetailBody() {
  const { slug = '' } = useParams();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const { notice, setNotice, statusRef } = useAdminNotice();
  const utils = trpc.useUtils();
  const seriesQuery = trpc.admin.series.list.useQuery();
  const cardsQuery = trpc.series.bySlug.useQuery({ slug }, { enabled: Boolean(slug) });
  const remove = trpc.admin.cards.delete.useMutation();
  const [filter, setFilter] = useState('');
  const [confirmingSlug, setConfirmingSlug] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ slug: string; message: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusDeleteSlug = useRef<string | null>(null);
  const series = ((seriesQuery.data?.items ?? []) as AdminSeriesItem[]).find(
    (item) => item.slug === slug,
  );
  const cards = useMemo(
    () => ((cardsQuery.data?.cards ?? []) as PublicCard[]).filter((card) => !hidden.has(card.slug)),
    [cardsQuery.data?.cards, hidden],
  );
  const queryText = filter.trim().toLowerCase();
  const visible = cards.filter(
    (card) =>
      card.name.toLowerCase().includes(queryText) || card.slug.toLowerCase().includes(queryText),
  );
  const revoked = seriesQuery.isError && isAccessRevoked(seriesQuery.error);
  const detailView = queryFallback(seriesQuery, cardsQuery);
  useFocusOnRecovery(detailView, titleRef);
  const missing = detailView === 'ready' && (!series || cardsQuery.data == null);

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [revoked, reportForbidden]);

  useEffect(() => {
    if (confirmingSlug || !focusDeleteSlug.current) return;
    const cardSlug = focusDeleteSlug.current;
    focusDeleteSlug.current = null;
    deleteRefs.current.get(cardSlug)?.focus();
  }, [confirmingSlug]);

  const seriesName = series?.title ?? slug;
  const title = tt('admin.cards.caption', { series: seriesName });

  const confirmDelete = async (card: PublicCard, reason?: string) => {
    setRowError(null);
    setPendingSlug(card.slug);
    try {
      await remove.mutateAsync(reason ? { slug: card.slug, reason } : { slug: card.slug });
      setHidden((current) => new Set(current).add(card.slug));
      setConfirmingSlug(null);
      setNotice(tt('admin.cards.deleted', { name: card.name }));
      void utils.admin.series.list.invalidate();
      void utils.series.bySlug.invalidate({ slug });
    } catch (error) {
      if (isAccessRevoked(error)) {
        reportForbidden();
        return;
      }
      setRowError({
        slug: card.slug,
        message: failureText(locale.locale, error, 'admin.deleteFailed'),
      });
    } finally {
      setPendingSlug(null);
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: tt('breadcrumb.home'), to: '/' },
          { label: tt('nav.admin') },
          { label: tt('nav.catalog'), to: '/admin/catalog' },
          { label: series?.title ?? slug },
        ]}
      />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {title}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <span className="font-mono">{slug}</span>
            {series ? (
              <span>
                {tt('admin.col.cards')} {series.cardCount}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to={`/admin/catalog/series/${slug}/edit`}>{tt('admin.series.edit')}</Link>
          </Button>
          <Button asChild>
            <Link to={`/admin/catalog/series/${slug}/cards/new`}>{tt('admin.cards.new')}</Link>
          </Button>
        </div>
      </header>
      <SubsetSection seriesSlug={slug} onForbidden={reportForbidden} />
      <PageMeta title={series?.title ?? tt('nav.catalog')} />
      <AdminStatus message={notice} statusRef={statusRef} />
      {detailView === 'error' ? (
        revoked ? null : (
          <AdminErrorBox
            title={tt('state.error')}
            onRetry={() => {
              void seriesQuery.refetch();
              void cardsQuery.refetch();
            }}
            retrying={seriesQuery.isFetching || cardsQuery.isFetching}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
          />
        )
      ) : detailView === 'loading' ? (
        <AdminTable caption={tt('admin.cards.caption', { series: series?.title ?? slug })} busy>
          <CardHead tt={tt} />
          <tbody>
            {Array.from({ length: 5 }, (_, index) => (
              <tr key={index}>
                <td className="px-3 py-2">
                  <span
                    className={`block w-8 animate-pulse motion-reduce:animate-none rounded-sm bg-neutral-200 ${ART_ASPECT.card}`}
                  />
                </td>
                {Array.from({ length: 4 }, (_, cell) => (
                  <td key={cell} className="px-3 py-2">
                    <span className="block h-4 animate-pulse motion-reduce:animate-none rounded bg-neutral-200" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </AdminTable>
      ) : missing ? (
        <AdminEmpty>{tt('state.notFound')}</AdminEmpty>
      ) : cards.length === 0 ? (
        <AdminEmpty>
          <p>{tt('admin.cards.empty')}</p>
          <div className="mt-4">
            <Button asChild>
              <Link to={`/admin/catalog/series/${slug}/cards/new`}>{tt('admin.cards.new')}</Link>
            </Button>
          </div>
        </AdminEmpty>
      ) : (
        <>
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
              aria-hidden
            />
            <Input
              size="sm"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setNotice(null);
              }}
              placeholder={tt('admin.cards.filter')}
              aria-label={tt('admin.cards.filter')}
              className="w-full pl-8"
            />
          </div>
          <AdminTable caption={tt('admin.cards.caption', { series: series?.title ?? slug })}>
            <CardHead tt={tt} />
            <tbody className="divide-y divide-neutral-200">
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-3 py-8 text-center text-sm text-neutral-600">
                    {tt('search.empty')}
                  </td>
                </tr>
              ) : (
                visible.map((card) => {
                  const confirming = confirmingSlug === card.slug;
                  const rarity = (['common', 'rare', 'epic', 'legendary'] as const).includes(
                    card.rarity as 'common',
                  )
                    ? (card.rarity as 'common' | 'rare' | 'epic' | 'legendary')
                    : 'common';
                  return (
                    <Fragment key={card.slug}>
                      <tr className="hover:bg-neutral-50">
                        <td className="px-3 py-2 align-middle">
                          <CardThumb width="w-8" src={card.imageUrl} slug={card.slug} />
                        </td>
                        <th
                          scope="row"
                          className="px-3 py-2 text-left align-middle font-medium text-neutral-900"
                        >
                          <Link
                            to={`/admin/catalog/cards/${card.slug}/edit`}
                            className="hover:underline"
                          >
                            {card.name}
                          </Link>
                        </th>
                        <td className="px-3 py-2 align-middle font-mono text-xs text-neutral-600">
                          {card.slug}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <RarityBadge rarity={rarity} locale={locale.locale} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
                          {confirming ? null : (
                            <div className="inline-flex items-center gap-3">
                              <Link
                                to={`/admin/catalog/cards/${card.slug}/edit`}
                                aria-label={tt('admin.action.editAria', { name: card.name })}
                                className={`${actionClass} text-xs font-medium text-brand-600 hover:underline`}
                              >
                                {tt('admin.action.edit')}
                              </Link>
                              <a
                                href={`/cards/${card.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={tt('admin.action.viewAria', { name: card.name })}
                                className={`${actionClass} text-xs text-neutral-600 hover:underline`}
                              >
                                {tt('admin.action.view')}
                              </a>
                              <button
                                type="button"
                                ref={(node) => {
                                  if (node) deleteRefs.current.set(card.slug, node);
                                  else deleteRefs.current.delete(card.slug);
                                }}
                                aria-label={tt('admin.action.deleteAria', { name: card.name })}
                                onClick={() => {
                                  setNotice(null);
                                  setRowError(null);
                                  setConfirmingSlug(card.slug);
                                }}
                                className={`${actionClass} text-xs text-red-700 hover:underline`}
                              >
                                {tt('admin.action.delete')}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {confirming ? (
                        <AdminConfirmRow
                          colSpan={COLUMNS}
                          label={tt('admin.cards.confirmDelete', { name: card.name })}
                          confirmLabel={
                            pendingSlug === card.slug
                              ? tt('admin.deleting')
                              : tt('admin.action.delete')
                          }
                          cancelLabel={tt('admin.cancel')}
                          disabled={pendingSlug === card.slug}
                          askReason
                          onConfirm={(reason) => void confirmDelete(card, reason)}
                          onCancel={() => {
                            focusDeleteSlug.current = card.slug;
                            setConfirmingSlug(null);
                            setRowError(null);
                          }}
                        />
                      ) : null}
                      {rowError?.slug === card.slug ? (
                        <tr>
                          <td colSpan={COLUMNS} className="px-3 pb-2">
                            <p
                              role="alert"
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                            >
                              {rowError.message}
                            </p>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </AdminTable>
        </>
      )}
    </div>
  );
});

function CardHead({ tt }: { tt: (key: string) => string }) {
  return (
    <AdminTableHead>
      <AdminTh>{tt('admin.col.image')}</AdminTh>
      <AdminTh>{tt('admin.col.name')}</AdminTh>
      <AdminTh>{tt('admin.col.slug')}</AdminTh>
      <AdminTh>{tt('admin.col.rarity')}</AdminTh>
      <AdminTh align="right">{tt('admin.col.actions')}</AdminTh>
    </AdminTableHead>
  );
}
