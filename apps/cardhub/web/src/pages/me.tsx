import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button, Card, CardContent, CardHeader } from '@repo/ui-web';
import { t, type ListingKind, type ListingStatus } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { CardThumb } from '../components/card-thumb';
import { ListingCloseControl } from '../components/listing-close-control';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

type SectionId = 'me-listings' | 'me-topics' | 'me-comments';
type LoadMoreQuery = {
  fetchNextPage: () => Promise<{
    isError: boolean;
    hasNextPage?: boolean;
    data?: { pages: Array<{ items: Array<{ id: string }> }> };
  }>;
};

function formatPrice(price: string | null, currency: string, fallback: string, locale: string) {
  if (!price) return fallback;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(price));
  } catch {
    return `${currency} ${price}`;
  }
}

function formatDateTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function splitOnCardPattern(pattern: string) {
  const token = '{card}';
  const index = pattern.indexOf(token);
  if (index === -1) return { before: pattern, after: '' };
  return { before: pattern.slice(0, index), after: pattern.slice(index + token.length) };
}

function KindChip({ kind, label }: { kind: ListingKind; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        kind === 'SELL' ? 'bg-brand-50 text-brand-700' : 'bg-neutral-100 text-neutral-700'
      }`}
    >
      {label}
    </span>
  );
}

function StatusChip({ status, label }: { status: ListingStatus; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        status === 'OPEN'
          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
          : 'bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200'
      }`}
    >
      {label}
    </span>
  );
}

function ErrorState({
  onRetry,
  message,
  retryLabel,
}: {
  onRetry: () => void;
  message: string;
  retryLabel: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {message}
      <button type="button" className="ml-2 font-medium underline" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

function SectionSkeleton({ withThumb }: { withThumb?: boolean }) {
  return (
    <ul className="divide-y divide-neutral-200/70">
      {Array.from({ length: 3 }).map((_, index) => (
        <li
          key={index}
          className={`grid animate-pulse gap-3 py-3 first:pt-0 last:pb-0 ${
            withThumb ? 'grid-cols-[auto_minmax(0,1fr)]' : ''
          }`}
        >
          {withThumb ? <div className="aspect-[63/88] w-10 rounded-sm bg-neutral-200" /> : null}
          <div className="min-w-0 space-y-2">
            <div className="h-4 w-3/4 rounded bg-neutral-200" />
            <div className="h-3 w-1/2 rounded bg-neutral-200" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MeSection({
  id,
  title,
  count,
  action,
  isLoading,
  notice,
  children,
}: {
  id: SectionId;
  title: string;
  count?: number;
  action?: { to: string; label: string };
  isLoading?: boolean;
  notice?: React.ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      aria-busy={isLoading || undefined}
      className="scroll-mt-20"
    >
      <Card className="border-white/60 bg-white/70 backdrop-blur">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <h2
            id={`${id}-title`}
            tabIndex={-1}
            className="text-base font-semibold text-neutral-900 focus:outline-none"
          >
            {title}{' '}
            {count !== undefined ? (
              <span className="font-normal text-neutral-500">{count}</span>
            ) : null}
          </h2>
          {action ? (
            <Link
              to={action.to}
              className="text-sm text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              {action.label}
            </Link>
          ) : null}
        </CardHeader>
        <CardContent>
          {notice}
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

export const MePage = observer(function MePage() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const location = useLocation();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [hash, setHash] = useState(location.hash);
  const [successNoticeId, setSuccessNoticeId] = useState(0);
  const [pendingFocus, setPendingFocus] = useState<{
    id: string;
    section: SectionId;
  } | null>(null);
  const successRef = useRef<HTMLParagraphElement | null>(null);
  const loadedHashRef = useRef<string | null>(null);
  const listingLoadMoreRef = useRef<HTMLButtonElement | null>(null);
  const topicLoadMoreRef = useRef<HTMLButtonElement | null>(null);
  const commentLoadMoreRef = useRef<HTMLButtonElement | null>(null);
  const listingRefs = useRef(new Map<string, HTMLLIElement>());
  const topicRefs = useRef(new Map<string, HTMLLIElement>());
  const commentRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!session.isAuthenticated) {
      navigate('/login', {
        replace: true,
        state: { from: `/me${location.search}${location.hash}` },
      });
    }
  }, [session.isAuthenticated, navigate, location.search, location.hash]);

  const me = trpc.users.me.useQuery(undefined, { enabled: session.isAuthenticated, retry: false });
  const listings = trpc.listings.mine.useInfiniteQuery(
    { limit: 10 },
    { enabled: session.isAuthenticated, getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const topics = trpc.users.myTopics.useInfiniteQuery(
    { limit: 10 },
    { enabled: session.isAuthenticated, getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const comments = trpc.users.myComments.useInfiniteQuery(
    { limit: 10 },
    { enabled: session.isAuthenticated, getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const utils = trpc.useUtils();

  useEffect(() => {
    const unauthorized =
      me.error?.data?.code === 'UNAUTHORIZED' ||
      listings.error?.data?.code === 'UNAUTHORIZED' ||
      topics.error?.data?.code === 'UNAUTHORIZED' ||
      comments.error?.data?.code === 'UNAUTHORIZED';
    if (unauthorized) {
      session.signOut();
      navigate('/login', {
        replace: true,
        state: { from: `/me${location.search}${location.hash}` },
      });
    }
  }, [
    comments.error,
    listings.error,
    location.hash,
    location.search,
    me.error,
    navigate,
    session,
    topics.error,
  ]);

  const listingItems = listings.data?.pages.flatMap((page) => page.items) ?? [];
  const topicItems = topics.data?.pages.flatMap((page) => page.items) ?? [];
  const commentItems = comments.data?.pages.flatMap((page) => page.items) ?? [];

  const sectionCounts = useMemo(
    () => ({
      listings: me.data?.listingTotalCount,
      topics: me.data?.topicCount,
      comments: me.data?.commentCount,
    }),
    [me.data],
  );

  useEffect(() => {
    if (!me.isSuccess) return;
    const target = location.hash as `#${SectionId}` | '';
    if (!target || loadedHashRef.current === target) return;
    const id = target.slice(1);
    if (!['me-listings', 'me-topics', 'me-comments'].includes(id)) return;
    loadedHashRef.current = target;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
      document.getElementById(`${id}-title`)?.focus();
    });
  }, [location.hash, me.isSuccess]);

  useEffect(() => {
    if (successNoticeId > 0) {
      requestAnimationFrame(() => successRef.current?.focus());
    }
  }, [successNoticeId]);

  useEffect(() => {
    if (!pendingFocus) return;
    const refs =
      pendingFocus.section === 'me-listings'
        ? listingRefs
        : pendingFocus.section === 'me-topics'
          ? topicRefs
          : commentRefs;
    const node = refs.current.get(pendingFocus.id);
    if (node) {
      requestAnimationFrame(() => node.focus());
      setPendingFocus(null);
    }
  }, [commentItems.length, listingItems.length, pendingFocus, topicItems.length]);

  if (!session.isAuthenticated) return null;

  const updateHash = (id: SectionId) => {
    const nextHash = `#${id}`;
    window.history.replaceState(
      window.history.state,
      '',
      `${location.pathname}${location.search}${nextHash}`,
    );
    setHash(nextHash);
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    requestAnimationFrame(() => document.getElementById(`${id}-title`)?.focus());
  };

  const closeListing = (listingId: string) => {
    utils.listings.mine.setInfiniteData({ limit: 10 }, (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((item) =>
            item.id === listingId ? { ...item, status: 'CLOSED' as const } : item,
          ),
        })),
      };
    });
    setSuccessNoticeId((current) => current + 1);
  };

  const loadMore = async (
    query: LoadMoreQuery,
    buttonRef: RefObject<HTMLButtonElement | null>,
    itemRefs: MutableRefObject<Map<string, HTMLLIElement>>,
    currentLength: number,
    section: SectionId,
  ) => {
    const result = await query.fetchNextPage();
    if (result.isError) return;
    requestAnimationFrame(() => {
      const pages = result.data?.pages ?? [];
      const items = pages.flatMap((page) => page.items as Array<{ id: string }>);
      const firstNew = items[currentLength];
      if (result.hasNextPage) {
        buttonRef.current?.focus();
      } else if (firstNew) {
        itemRefs.current.get(firstNew.id)?.focus();
        setPendingFocus({ id: firstNew.id, section });
      }
    });
  };

  return (
    <PageShell>
      <PageMeta title={tt('me.title')} />
      <div className="mx-auto max-w-3xl space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('me.title') }]}
        />

        <section id="me-overview" aria-labelledby="me-overview-title">
          <Card className="border-white/60 bg-white/70 backdrop-blur">
            <CardContent className="space-y-4 pt-6">
              {me.isLoading ? (
                <div className="animate-pulse space-y-4">
                  <div className="space-y-2">
                    <div className="h-8 w-40 rounded bg-neutral-200" />
                    <div className="h-4 w-64 max-w-full rounded bg-neutral-200" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="h-14 rounded-lg bg-neutral-200" />
                    ))}
                  </div>
                </div>
              ) : me.isError ? (
                <ErrorState
                  onRetry={() => void me.refetch()}
                  message={tt('state.error')}
                  retryLabel={tt('state.retry')}
                />
              ) : me.data ? (
                <>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1
                        id="me-overview-title"
                        className="min-w-0 truncate text-2xl font-bold tracking-tight text-neutral-900"
                      >
                        @{me.data.username}
                      </h1>
                      {me.data.role === 'admin' ? (
                        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                          {tt('me.roleAdmin')}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-neutral-600 [overflow-wrap:anywhere]">
                      {me.data.email} ·{' '}
                      {tt('me.joinedAt', {
                        date: new Date(me.data.createdAt).toLocaleDateString(locale.locale, {
                          dateStyle: 'long',
                        }),
                      })}
                    </p>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: tt('me.stats.listings'), count: me.data.listingTotalCount },
                      { label: tt('me.stats.topics'), count: me.data.topicCount },
                      { label: tt('me.stats.replies'), count: me.data.replyCount },
                      { label: tt('me.stats.comments'), count: me.data.commentCount },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2"
                      >
                        <dt className="text-xs text-neutral-600">{stat.label}</dt>
                        <dd className="text-xl font-semibold tabular-nums text-neutral-900">
                          {stat.count}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <nav aria-label={tt('me.sectionsNav')}>
          <ul className="flex flex-wrap gap-2">
            {[
              {
                id: 'me-listings' as const,
                label: tt('me.listings.title'),
                count: sectionCounts.listings,
              },
              {
                id: 'me-topics' as const,
                label: tt('me.topics.title'),
                count: sectionCounts.topics,
              },
              {
                id: 'me-comments' as const,
                label: tt('me.comments.title'),
                count: sectionCounts.comments,
              },
            ].map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    updateHash(section.id);
                  }}
                  aria-current={hash === `#${section.id}` ? 'location' : undefined}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 text-sm text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 aria-[current=location]:border-neutral-900 aria-[current=location]:font-medium aria-[current=location]:text-neutral-900"
                >
                  {section.label}
                  {section.count !== undefined ? (
                    <span className="tabular-nums text-neutral-500">{section.count}</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <MeSection
          id="me-listings"
          title={tt('me.listings.title')}
          count={sectionCounts.listings}
          action={{ to: '/trade/new', label: tt('trade.list.publish') }}
          isLoading={listings.isLoading}
          notice={
            successNoticeId > 0 ? (
              <p
                ref={successRef}
                role="status"
                tabIndex={-1}
                className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {tt('trade.closed')}
              </p>
            ) : null
          }
        >
          {listings.isLoading ? (
            <SectionSkeleton withThumb />
          ) : listings.isError ? (
            <ErrorState
              onRetry={() => void listings.refetch()}
              message={tt('state.error')}
              retryLabel={tt('state.retry')}
            />
          ) : listings.isSuccess && listingItems.length === 0 ? (
            <div className="space-y-3">
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600">
                {tt('me.listings.empty')}
              </p>
              <div className="flex justify-center">
                <Button variant="outline" asChild>
                  <Link to="/trade/new">{tt('trade.list.publish')}</Link>
                </Button>
              </div>
            </div>
          ) : listings.isSuccess ? (
            <>
              <ul className="divide-y divide-neutral-200/70">
                {listingItems.map((listing) => (
                  <li
                    key={listing.id}
                    tabIndex={-1}
                    ref={(node) => {
                      if (node) listingRefs.current.set(listing.id, node);
                      else listingRefs.current.delete(listing.id);
                    }}
                    className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0 focus:outline-none"
                  >
                    <Link to={`/cards/${listing.cardSlug}`} tabIndex={-1} aria-hidden>
                      <CardThumb width="w-10" slug={listing.cardSlug} />
                    </Link>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <KindChip
                          kind={listing.kind}
                          label={tt(
                            listing.kind === 'SELL' ? 'trade.list.kindSell' : 'trade.list.kindBuy',
                          )}
                        />
                        <Link
                          to={`/cards/${listing.cardSlug}`}
                          className="min-w-0 truncate font-mono text-sm font-semibold text-neutral-900 hover:underline"
                        >
                          {listing.cardSlug}
                        </Link>
                        <StatusChip
                          status={listing.status}
                          label={tt(
                            listing.status === 'OPEN'
                              ? 'trade.list.statusOpen'
                              : 'trade.list.statusClosed',
                          )}
                        />
                      </div>
                      <p className="text-sm text-neutral-900">
                        {formatPrice(
                          listing.price,
                          listing.currency,
                          tt('trade.list.priceFree'),
                          locale.locale,
                        )}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <time
                          dateTime={listing.createdAt}
                          className="whitespace-nowrap text-xs text-neutral-600"
                        >
                          {formatDateTime(listing.createdAt, locale.locale)}
                        </time>
                        {listing.status === 'OPEN' ? (
                          <ListingCloseControl listingId={listing.id} onClosed={closeListing} />
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {listings.hasNextPage ? (
                <div className="flex justify-center pt-3">
                  <Button
                    ref={listingLoadMoreRef}
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={listings.isFetchingNextPage}
                    aria-busy={listings.isFetchingNextPage || undefined}
                    onClick={() =>
                      void loadMore(
                        listings,
                        listingLoadMoreRef,
                        listingRefs,
                        listingItems.length,
                        'me-listings',
                      )
                    }
                  >
                    {listings.isFetchingNextPage ? tt('state.loading') : tt('me.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </MeSection>

        <MeSection
          id="me-topics"
          title={tt('me.topics.title')}
          count={sectionCounts.topics}
          action={{ to: '/forum/new', label: tt('forum.list.newTopic') }}
          isLoading={topics.isLoading}
        >
          {topics.isLoading ? (
            <SectionSkeleton />
          ) : topics.isError ? (
            <ErrorState
              onRetry={() => void topics.refetch()}
              message={tt('state.error')}
              retryLabel={tt('state.retry')}
            />
          ) : topics.isSuccess && topicItems.length === 0 ? (
            <div className="space-y-3">
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600">
                {tt('me.topics.empty')}
              </p>
              <div className="flex justify-center">
                <Button variant="outline" asChild>
                  <Link to="/forum/new">{tt('forum.list.newTopic')}</Link>
                </Button>
              </div>
            </div>
          ) : topics.isSuccess ? (
            <>
              <ul className="divide-y divide-neutral-200/70">
                {topicItems.map((topic) => (
                  <li
                    key={topic.id}
                    tabIndex={-1}
                    ref={(node) => {
                      if (node) topicRefs.current.set(topic.id, node);
                      else topicRefs.current.delete(topic.id);
                    }}
                    className="py-3 first:pt-0 last:pb-0 focus:outline-none"
                  >
                    <Link
                      to={`/forum/${topic.slug}`}
                      className="block text-sm font-semibold text-neutral-900 hover:underline [overflow-wrap:anywhere]"
                    >
                      {topic.title}
                    </Link>
                    <p className="mt-1 text-xs text-neutral-600">
                      {tt('forum.list.replyCount', { count: topic.replyCount })} ·{' '}
                      <time dateTime={topic.createdAt} className="whitespace-nowrap">
                        {formatDateTime(topic.createdAt, locale.locale)}
                      </time>
                    </p>
                  </li>
                ))}
              </ul>
              {topics.hasNextPage ? (
                <div className="flex justify-center pt-3">
                  <Button
                    ref={topicLoadMoreRef}
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={topics.isFetchingNextPage}
                    aria-busy={topics.isFetchingNextPage || undefined}
                    onClick={() =>
                      void loadMore(
                        topics,
                        topicLoadMoreRef,
                        topicRefs,
                        topicItems.length,
                        'me-topics',
                      )
                    }
                  >
                    {topics.isFetchingNextPage ? tt('state.loading') : tt('me.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </MeSection>

        <MeSection
          id="me-comments"
          title={tt('me.comments.title')}
          count={sectionCounts.comments}
          isLoading={comments.isLoading}
        >
          {comments.isLoading ? (
            <SectionSkeleton withThumb />
          ) : comments.isError ? (
            <ErrorState
              onRetry={() => void comments.refetch()}
              message={tt('state.error')}
              retryLabel={tt('state.retry')}
            />
          ) : comments.isSuccess && commentItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600">
              {tt('me.comments.empty')}
            </p>
          ) : comments.isSuccess ? (
            <>
              <ul className="divide-y divide-neutral-200/70">
                {commentItems.map((comment) => {
                  const label =
                    comment.target.kind === 'card' ? comment.target.name : comment.target.title;
                  const href =
                    comment.target.kind === 'card'
                      ? `/cards/${comment.target.slug}`
                      : `/series/${comment.target.slug}`;
                  const parts = splitOnCardPattern(tt('me.comments.onCard', { card: '{card}' }));
                  return (
                    <li
                      key={comment.id}
                      tabIndex={-1}
                      ref={(node) => {
                        if (node) commentRefs.current.set(comment.id, node);
                        else commentRefs.current.delete(comment.id);
                      }}
                      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0 focus:outline-none"
                    >
                      <Link to={href} tabIndex={-1} aria-hidden>
                        <CardThumb
                          width="w-10"
                          src={comment.target.kind === 'card' ? comment.target.imageUrl : null}
                          slug={comment.target.slug}
                        />
                      </Link>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs text-neutral-600">
                          {parts.before}
                          <Link to={href} className="font-medium text-neutral-900 hover:underline">
                            {label}
                          </Link>
                          {parts.after} ·{' '}
                          <time dateTime={comment.createdAt} className="whitespace-nowrap">
                            {formatDateTime(comment.createdAt, locale.locale)}
                          </time>
                        </p>
                        <p className="line-clamp-2 whitespace-pre-wrap text-sm text-neutral-800 [overflow-wrap:anywhere]">
                          {comment.body}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {comments.hasNextPage ? (
                <div className="flex justify-center pt-3">
                  <Button
                    ref={commentLoadMoreRef}
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={comments.isFetchingNextPage}
                    aria-busy={comments.isFetchingNextPage || undefined}
                    onClick={() =>
                      void loadMore(
                        comments,
                        commentLoadMoreRef,
                        commentRefs,
                        commentItems.length,
                        'me-comments',
                      )
                    }
                  >
                    {comments.isFetchingNextPage ? tt('state.loading') : tt('me.loadMore')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </MeSection>
      </div>
    </PageShell>
  );
});
