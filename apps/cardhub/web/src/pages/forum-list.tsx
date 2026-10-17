import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '@repo/ui-web';
import { t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const ForumListPage = observer(function ForumListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const noticeRef = useRef<HTMLParagraphElement>(null);

  // useInfiniteQuery on the cursor-based topics.list — getNextPageParam
  // returns the cursor returned by the server; null halts the chain.
  const query = trpc.forum.topics.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    if ((location.state as { notice?: string } | null)?.notice !== 'topicDeleted') return;
    setNotice(tt('forum.detail.topicDeleted'));
    navigate('.', { replace: true, state: null });
  }, [location.state, navigate, tt]);

  useEffect(() => {
    if (notice) {
      noticeRef.current?.focus();
    }
  }, [notice]);

  return (
    <PageShell>
      <PageMeta title={tt('forum.list.title')} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('forum.list.title') }]}
        />
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{tt('forum.list.title')}</h1>
            <p className="text-neutral-600">{tt('forum.list.subtitle')}</p>
          </div>
          {session.isAuthenticated ? (
            <Button asChild>
              <Link to="/forum/new">{tt('forum.list.newTopic')}</Link>
            </Button>
          ) : (
            <Link
              to="/login"
              state={{ from: '/forum' }}
              className="text-sm text-brand-600 hover:underline"
            >
              {tt('forum.list.loginToPost')}
            </Link>
          )}
        </header>

        {notice ? (
          <p
            ref={noticeRef}
            role="status"
            tabIndex={-1}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {notice}
          </p>
        ) : null}

        {query.isLoading ? (
          <ul className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <li
                key={idx}
                className="h-24 animate-pulse rounded-2xl border border-white/60 bg-white/50"
              />
            ))}
          </ul>
        ) : query.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            <p className="font-medium">{tt('state.error')}</p>
            <p className="mt-1 break-all text-xs opacity-80">{query.error.message}</p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              {tt('state.retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {tt('forum.list.empty')}
          </p>
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((topic) => (
                <li key={topic.id}>
                  <Link
                    to={`/forum/${topic.slug}`}
                    className="group block rounded-2xl border border-white/60 bg-white/70 p-5 shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-lg font-semibold text-neutral-900 group-hover:text-brand-700">
                        {topic.title}
                      </h3>
                      <span className="shrink-0 text-xs text-neutral-500">
                        {tt('forum.list.replyCount', { count: topic.replyCount })}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-neutral-600">{topic.body}</p>
                    <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                      <span className="font-medium text-neutral-700">@{topic.author.username}</span>
                      <time dateTime={topic.createdAt}>
                        {new Date(topic.createdAt).toLocaleString(locale.locale)}
                      </time>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            {query.hasNextPage ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? tt('state.loading') : tt('forum.list.loadMore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
});
