import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { replyBodySchema, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { MarkdownView } from '../components/markdown-view';
import { ReportButton } from '../components/report-button';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

interface TopicReply {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string };
}

function mergeReplies(replies: TopicReply[]): TopicReply[] {
  const seen = new Set<string>();
  return replies.filter((reply) => {
    if (seen.has(reply.id)) return false;
    seen.add(reply.id);
    return true;
  });
}

function fetchNextPageFailed(result: { isError?: boolean }): boolean {
  return result.isError === true;
}

export const ForumDetailPage = observer(function ForumDetailPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const topicQuery = trpc.forum.topics.bySlug.useQuery({ slug }, { enabled: !!slug });
  const utils = trpc.useUtils();

  const [replyBody, setReplyBody] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [showLoadedReplyPages, setShowLoadedReplyPages] = useState(false);
  const [replyStatusMessage, setReplyStatusMessage] = useState('');
  const [focusReplyId, setFocusReplyId] = useState<string | null>(null);
  const [pendingCreatedReplyId, setPendingCreatedReplyId] = useState<string | null>(null);
  const [autoLoadFailedReplyId, setAutoLoadFailedReplyId] = useState<string | null>(null);
  const [isRetryingReplies, setIsRetryingReplies] = useState(false);
  const [highlightedReplyId, setHighlightedReplyId] = useState<string | null>(null);
  const replyRefs = useRef(new Map<string, HTMLLIElement>());
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const previousReplyNextCursorRef = useRef<string | null>(null);

  // Valid UUID placeholder keeps the query input shape stable while `enabled`
  // prevents requests before the topic has loaded.
  const topicId = topicQuery.data?.id ?? '00000000-0000-0000-0000-000000000000';
  const replyNextCursor = topicQuery.data?.replyNextCursor ?? null;
  const repliesQuery = trpc.forum.replies.list.useInfiniteQuery(
    { topicId, limit: 20 },
    {
      enabled: showLoadedReplyPages && !!replyNextCursor,
      initialCursor: replyNextCursor ?? undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    },
  );

  const hiddenLoadedReplies = useMemo(
    () => mergeReplies(repliesQuery.data?.pages.flatMap((page) => page.items) ?? []),
    [repliesQuery.data],
  );
  const visibleReplies = useMemo(() => {
    const inlineReplies = (topicQuery.data?.replies ?? []) as TopicReply[];
    return mergeReplies([...inlineReplies, ...(showLoadedReplyPages ? hiddenLoadedReplies : [])]);
  }, [hiddenLoadedReplies, showLoadedReplyPages, topicQuery.data?.replies]);

  const createReply = trpc.forum.replies.create.useMutation({
    async onSuccess(created) {
      setReplyBody('');
      setReplyError(null);
      setShowLoadedReplyPages(true);
      setPendingCreatedReplyId(created.id);
      setFocusReplyId(created.id);
      setAutoLoadFailedReplyId(null);
      await Promise.all([
        utils.forum.topics.bySlug.invalidate({ slug }),
        utils.forum.replies.list.invalidate({ topicId }),
      ]);
    },
    onError(err) {
      setReplyError(err.message);
    },
  });

  const deleteTopic = trpc.forum.topics.delete.useMutation({
    onSuccess() {
      void utils.forum.topics.list.invalidate();
      navigate('/forum');
    },
  });

  const deleteReply = trpc.forum.replies.delete.useMutation({
    onSuccess() {
      void Promise.all([
        utils.forum.topics.bySlug.invalidate({ slug }),
        utils.forum.replies.list.invalidate({ topicId }),
      ]);
    },
  });

  useEffect(() => {
    setShowLoadedReplyPages(false);
    setReplyStatusMessage('');
    setFocusReplyId(null);
    setPendingCreatedReplyId(null);
    setAutoLoadFailedReplyId(null);
    setIsRetryingReplies(false);
    setHighlightedReplyId(null);
    previousReplyNextCursorRef.current = null;
  }, [topicId]);

  useEffect(() => {
    if (previousReplyNextCursorRef.current === replyNextCursor) return;
    previousReplyNextCursorRef.current = replyNextCursor;
    void utils.forum.replies.list.reset({ topicId, limit: 20 });
  }, [replyNextCursor, topicId, utils]);

  useEffect(() => {
    if (!focusReplyId) return;
    const node = replyRefs.current.get(focusReplyId);
    if (!node) return;
    node.focus();
    setHighlightedReplyId(focusReplyId);
    setFocusReplyId(null);
  }, [focusReplyId, visibleReplies]);

  useEffect(() => {
    if (!highlightedReplyId) return;
    const timer = window.setTimeout(() => setHighlightedReplyId(null), 1000);
    return () => window.clearTimeout(timer);
  }, [highlightedReplyId]);

  const fetchNextRepliesPage = useCallback(
    async (failureId: string) => {
      try {
        const result = await repliesQuery.fetchNextPage();
        if (fetchNextPageFailed(result)) {
          setAutoLoadFailedReplyId(failureId);
          return null;
        }
        return result;
      } catch {
        setAutoLoadFailedReplyId(failureId);
        return null;
      }
    },
    [repliesQuery.fetchNextPage],
  );

  useEffect(() => {
    if (!pendingCreatedReplyId) return;
    if (autoLoadFailedReplyId === pendingCreatedReplyId) return;
    if (repliesQuery.hasNextPage && !repliesQuery.isFetchingNextPage) {
      void (async () => {
        await fetchNextRepliesPage(pendingCreatedReplyId);
      })();
      return;
    }
    const createdReplyIsVisible = visibleReplies.some(
      (reply) => reply.id === pendingCreatedReplyId,
    );
    if (!repliesQuery.hasNextPage && !repliesQuery.isFetchingNextPage && createdReplyIsVisible) {
      setHighlightedReplyId(pendingCreatedReplyId);
      setFocusReplyId(pendingCreatedReplyId);
      replyRefs.current.get(pendingCreatedReplyId)?.scrollIntoView({ block: 'nearest' });
      setPendingCreatedReplyId(null);
    }
  }, [
    pendingCreatedReplyId,
    autoLoadFailedReplyId,
    fetchNextRepliesPage,
    repliesQuery.hasNextPage,
    repliesQuery.isFetchingNextPage,
    visibleReplies,
  ]);

  const isLoadingMoreReplies =
    isRetryingReplies ||
    repliesQuery.isFetchingNextPage ||
    (showLoadedReplyPages && repliesQuery.isLoading);
  const allRepliesShown =
    showLoadedReplyPages && repliesQuery.isSuccess && !repliesQuery.hasNextPage;
  const showLoadMoreError =
    (repliesQuery.isFetchNextPageError || autoLoadFailedReplyId !== null) && !isLoadingMoreReplies;

  useEffect(() => {
    if (showLoadMoreError) {
      retryButtonRef.current?.focus();
    }
  }, [showLoadMoreError]);

  if (topicQuery.isLoading) {
    return (
      <PageShell>
        <div className="space-y-4">
          <div className="h-6 w-1/3 animate-pulse rounded bg-neutral-200" />
          <div className="h-32 animate-pulse rounded-2xl bg-white/60" />
        </div>
      </PageShell>
    );
  }

  if (topicQuery.isError || !topicQuery.data) {
    const isNotFound = topicQuery.error?.data?.code === 'NOT_FOUND';
    return (
      <PageShell>
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('forum.list.title'), to: '/forum' },
              { label: slug },
            ]}
          />
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {isNotFound ? tt('state.notFound') : (topicQuery.error?.message ?? tt('state.error'))}
          </p>
        </div>
      </PageShell>
    );
  }

  const topic = topicQuery.data;
  const isOwner = session.user?.id === topic.author.id;
  const canDeleteTopic = isOwner || session.isAdmin;

  const onSubmitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReplyError(null);
    const parsed = replyBodySchema.safeParse(replyBody);
    if (!parsed.success) {
      setReplyError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
    createReply.mutate({ topicId: topic.id, body: parsed.data });
  };

  const onLoadMoreReplies = async () => {
    const beforeIds = new Set(visibleReplies.map((reply) => reply.id));
    setShowLoadedReplyPages(true);
    setAutoLoadFailedReplyId(null);
    const result = await fetchNextRepliesPage('manual');
    if (!result) return;
    const pages = result.data?.pages ?? [];
    const mergedLoadedReplies = mergeReplies(pages.flatMap((page) => page.items));
    const newReplies = mergedLoadedReplies.filter((reply) => !beforeIds.has(reply.id));
    if (newReplies.length > 0) {
      setReplyStatusMessage(tt('forum.detail.repliesLoaded', { count: newReplies.length }));
    }
    const hasNextPageAfterFetch = Boolean(pages.at(-1)?.nextCursor);
    if (!hasNextPageAfterFetch && newReplies[0]) {
      setFocusReplyId(newReplies[0].id);
    } else if (hasNextPageAfterFetch) {
      loadMoreButtonRef.current?.focus();
    }
  };

  return (
    <PageShell>
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('forum.list.title'), to: '/forum' },
            { label: topic.title },
          ]}
        />

        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-2xl">{topic.title}</CardTitle>
              <div className="flex items-center gap-2">
                {!isOwner ? <ReportButton targetType="TOPIC" targetId={topic.id} /> : null}
                {canDeleteTopic ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(tt('forum.detail.confirmDelete'))) {
                        deleteTopic.mutate({ id: topic.id });
                      }
                    }}
                    disabled={deleteTopic.isPending}
                    className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {tt('forum.detail.delete')}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">@{topic.author.username}</span>
              <time dateTime={topic.createdAt}>
                {new Date(topic.createdAt).toLocaleString(locale.locale)}
              </time>
            </div>
          </CardHeader>
          <CardContent>
            <MarkdownView body={topic.body} />
          </CardContent>
        </Card>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">
            {tt('forum.detail.repliesTitle', { count: topic.replyCount })}
          </h2>
          <p role="status" className="sr-only">
            {replyStatusMessage}
          </p>

          {visibleReplies.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-200 bg-white/60 p-4 text-center text-sm text-neutral-500">
              {tt('forum.detail.noReplies')}
            </p>
          ) : (
            <ul className="space-y-3">
              {visibleReplies.map((reply) => {
                const canDelete = session.user?.id === reply.author.id || session.isAdmin;
                return (
                  <li
                    key={reply.id}
                    ref={(node) => {
                      if (node) {
                        replyRefs.current.set(reply.id, node);
                      } else {
                        replyRefs.current.delete(reply.id);
                      }
                    }}
                    tabIndex={-1}
                    className={`rounded-2xl border p-4 backdrop-blur transition-colors duration-1000 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none ${
                      highlightedReplyId === reply.id
                        ? 'border-brand-200 bg-brand-50 duration-0'
                        : 'border-white/60 bg-white/80'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-neutral-500">
                      <span className="min-w-0 truncate font-medium text-neutral-700">
                        @{reply.author.username}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-3">
                        <time dateTime={reply.createdAt} className="whitespace-nowrap">
                          {new Date(reply.createdAt).toLocaleString(locale.locale)}
                        </time>
                        {session.user?.id !== reply.author.id ? (
                          <ReportButton targetType="REPLY" targetId={reply.id} />
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(tt('forum.detail.confirmDeleteReply'))) {
                                deleteReply.mutate({ id: reply.id });
                              }
                            }}
                            className="inline-flex min-h-6 items-center rounded px-1 text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                          >
                            {tt('forum.detail.delete')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2">
                      <MarkdownView body={reply.body} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {replyNextCursor ? (
            showLoadMoreError ? (
              <div
                role="alert"
                className="flex items-center justify-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                <span>{tt('forum.detail.loadMoreFailed')}</span>
                <button
                  ref={retryButtonRef}
                  type="button"
                  disabled={isRetryingReplies}
                  aria-busy={isRetryingReplies}
                  onClick={() => {
                    void (async () => {
                      setIsRetryingReplies(true);
                      if (pendingCreatedReplyId) {
                        const result = await fetchNextRepliesPage(pendingCreatedReplyId);
                        if (result) {
                          setAutoLoadFailedReplyId(null);
                        }
                      } else {
                        await onLoadMoreReplies();
                      }
                      setIsRetryingReplies(false);
                    })();
                  }}
                  className="min-h-9 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0"
                >
                  {isRetryingReplies ? tt('state.loading') : tt('state.retry')}
                </button>
              </div>
            ) : allRepliesShown ? (
              <p className="text-center text-xs text-neutral-600">
                {tt('forum.detail.allRepliesShown')}
              </p>
            ) : (
              <div className="flex justify-center">
                <Button
                  ref={loadMoreButtonRef}
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void onLoadMoreReplies()}
                  disabled={isLoadingMoreReplies}
                  aria-busy={isLoadingMoreReplies}
                >
                  {isLoadingMoreReplies ? tt('state.loading') : tt('forum.detail.loadMoreReplies')}
                </Button>
              </div>
            )
          ) : null}

          {session.isAuthenticated ? (
            <form
              onSubmit={onSubmitReply}
              className="space-y-2 rounded-2xl border border-white/60 bg-white/80 p-4 backdrop-blur"
            >
              <label htmlFor="reply-body" className="block text-sm font-medium text-neutral-700">
                {tt('forum.detail.replyLabel')}
              </label>
              <textarea
                id="reply-body"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder={tt('forum.detail.replyPlaceholder')}
                rows={4}
                maxLength={5000}
                className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              {replyError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {replyError}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-neutral-500">{tt('forum.detail.markdownNote')}</span>
                <Button type="submit" disabled={createReply.isPending || !replyBody.trim()}>
                  {createReply.isPending
                    ? tt('forum.detail.replySubmitting')
                    : tt('forum.detail.replySubmit')}
                </Button>
              </div>
            </form>
          ) : (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-4 text-center text-sm text-neutral-600 backdrop-blur">
              <Link
                to="/login"
                state={{ from: `/forum/${slug}` }}
                className="font-medium text-brand-600 hover:underline"
              >
                {tt('forum.detail.loginToReply')}
              </Link>
            </p>
          )}
        </section>
      </div>
    </PageShell>
  );
});
