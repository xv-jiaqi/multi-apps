import { observer } from 'mobx-react-lite';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Pin } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { appErrorMessage, replyBodySchema, t } from '@repo/shared';
import { DeleteReasonField } from '../components/delete-reason-field';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { MarkdownView } from '../components/markdown-view';
import { ReportButton } from '../components/report-button';
import { PageMeta } from '../components/page-meta';
import { useStores } from '../stores/root-store';
import { useAppMutationError } from '../lib/app-mutation-error';
import { BannedNotice } from '../components/banned-notice';
import { trpc } from '../lib/trpc';

interface TopicReply {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string };
}

type ConfirmingDelete = { kind: 'topic' } | { kind: 'reply'; id: string };
type DeleteFocusTarget = { kind: 'topic' } | { kind: 'reply'; id: string };
type DeleteError =
  | { kind: 'topic'; message: string }
  | { kind: 'reply'; id: string; message: string };

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
  const location = useLocation();
  const presentError = useAppMutationError();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const topicQuery = trpc.forum.topics.bySlug.useQuery({ slug }, { enabled: !!slug });
  const utils = trpc.useUtils();

  const [replyBody, setReplyBody] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [showLoadedReplyPages, setShowLoadedReplyPages] = useState(false);
  const [replyStatus, setReplyStatus] = useState({ message: '', visible: false });
  const [focusReplyId, setFocusReplyId] = useState<string | null>(null);
  const [pendingLoadedReplyFocusId, setPendingLoadedReplyFocusId] = useState<string | null>(null);
  const [restoreLoadMoreButtonFocus, setRestoreLoadMoreButtonFocus] = useState(false);
  const [pendingCreatedReplyId, setPendingCreatedReplyId] = useState<string | null>(null);
  const [autoLoadFailedReplyId, setAutoLoadFailedReplyId] = useState<string | null>(null);
  const [isRetryingReplies, setIsRetryingReplies] = useState(false);
  const [highlightedReplyId, setHighlightedReplyId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<ConfirmingDelete | null>(null);
  const [restoreDeleteFocus, setRestoreDeleteFocus] = useState<DeleteFocusTarget | null>(null);
  const [deleteError, setDeleteError] = useState<DeleteError | null>(null);
  const [topicNotice, setTopicNotice] = useState('');
  const [topicError, setTopicError] = useState('');
  const [showEditAction, setShowEditAction] = useState(false);
  const [restorePinFocus, setRestorePinFocus] = useState(false);
  const replyRefs = useRef(new Map<string, HTMLLIElement>());
  const replyDeleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const topicDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const replyStatusRef = useRef<HTMLParagraphElement>(null);
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const editLinkRef = useRef<HTMLAnchorElement>(null);
  const pinButtonRef = useRef<HTMLButtonElement>(null);
  const topicNoticeRef = useRef<HTMLParagraphElement>(null);

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

  function clearDeleteState() {
    setDeleteError(null);
    setReplyStatus((current) => (current.visible ? { message: '', visible: false } : current));
  }

  function clearTopicFeedback() {
    setTopicNotice('');
    setTopicError('');
    clearDeleteState();
  }

  function focusDeleteButton(target: DeleteFocusTarget) {
    setRestoreDeleteFocus(target);
  }

  function removeReplyFromCache(replyId: string) {
    const currentReplies = visibleReplies;
    const deletedIndex = currentReplies.findIndex((reply) => reply.id === replyId);
    const previousReplyId =
      deletedIndex > 0 ? (currentReplies[deletedIndex - 1]?.id ?? null) : null;
    const moveCursor = (cursor: string | null | undefined) =>
      cursor === replyId ? previousReplyId : cursor;

    utils.forum.topics.bySlug.setData({ slug }, (current) => {
      if (!current) return current;
      const replyExists = current.replies.some((reply) => reply.id === replyId);
      // Decrement only when this reply is on the inline page or an already
      // loaded page. One that is in neither cannot be deleted from this view,
      // so the displayed count stays unchanged.
      const nextCount =
        replyExists || deletedIndex >= 0 ? Math.max(0, current.replyCount - 1) : current.replyCount;
      return {
        ...current,
        replyCount: nextCount,
        replies: current.replies.filter((reply) => reply.id !== replyId),
        replyNextCursor: moveCursor(current.replyNextCursor) ?? null,
      };
    });

    utils.forum.replies.list.setInfiniteData({ topicId, limit: 20 }, (current) => {
      if (!current) return current;
      const movePageParam = (pageParam: string | null) =>
        pageParam === replyId ? previousReplyId : pageParam;
      return {
        ...current,
        pages: current.pages.map((page) => {
          const originalItems = page.items as TopicReply[];
          const indexInPage = originalItems.findIndex((reply) => reply.id === replyId);
          const previousInPage =
            indexInPage > 0 ? (originalItems[indexInPage - 1]?.id ?? null) : previousReplyId;
          return {
            ...page,
            items: originalItems.filter((reply) => reply.id !== replyId),
            nextCursor: page.nextCursor === replyId ? previousInPage : page.nextCursor,
          };
        }),
        pageParams: current.pageParams.map(movePageParam),
      };
    });
  }

  const createReply = trpc.forum.replies.create.useMutation({
    async onSuccess(created) {
      setReplyBody('');
      setReplyError(null);
      clearDeleteState();
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
      const message = presentError(err);
      if (message) setReplyError(message);
    },
  });

  const deleteTopic = trpc.forum.topics.delete.useMutation({
    async onSuccess() {
      await utils.forum.topics.list.invalidate();
      navigate('/forum', { replace: true, state: { notice: 'topicDeleted' } });
    },
    async onError(err) {
      if (err.data?.code === 'NOT_FOUND') {
        await utils.forum.topics.list.invalidate();
        navigate('/forum', { replace: true, state: { notice: 'topicDeleted' } });
        return;
      }
      const topic = topicQuery.data;
      const keepReason =
        session.isAdmin && topic !== undefined && session.user?.id !== topic.author.id;
      setDeleteError({
        kind: 'topic',
        message:
          err.data?.code === 'FORBIDDEN'
            ? tt('forum.detail.deleteTopicForbidden')
            : tt('forum.detail.deleteFailed'),
      });
      if (keepReason) return;
      setConfirmingDelete(null);
      focusDeleteButton({ kind: 'topic' });
    },
  });

  const setPinned = trpc.forum.topics.setPinned.useMutation({
    async onSuccess(updated) {
      setTopicError('');
      setTopicNotice(updated.pinned ? tt('forum.detail.pinned') : tt('forum.detail.unpinned'));
      setRestorePinFocus(true);
      await Promise.all([
        utils.forum.topics.bySlug.invalidate({ slug }),
        utils.forum.topics.list.invalidate(),
      ]);
    },
    onError(err) {
      setTopicNotice('');
      setTopicError(
        err.data?.code === 'FORBIDDEN'
          ? tt('forum.detail.pinForbidden')
          : tt('forum.detail.pinFailed'),
      );
      setRestorePinFocus(true);
    },
  });

  const deleteReply = trpc.forum.replies.delete.useMutation({
    onSuccess(_data, variables) {
      removeReplyFromCache(variables.id);
      setConfirmingDelete(null);
      setDeleteError(null);
      setReplyStatus({ message: tt('forum.detail.replyDeleted'), visible: true });
    },
    onError(err, variables) {
      if (err.data?.code === 'NOT_FOUND') {
        removeReplyFromCache(variables.id);
        setConfirmingDelete(null);
        setDeleteError(null);
        return;
      }
      const reply = visibleReplies.find((item) => item.id === variables.id);
      const keepReason =
        session.isAdmin && reply !== undefined && session.user?.id !== reply.author.id;
      setDeleteError({
        kind: 'reply',
        id: variables.id,
        message:
          err.data?.code === 'FORBIDDEN'
            ? tt('forum.detail.deleteReplyForbidden')
            : tt('forum.detail.deleteFailed'),
      });
      if (keepReason) return;
      setConfirmingDelete(null);
      focusDeleteButton({ kind: 'reply', id: variables.id });
    },
  });

  useEffect(() => {
    setShowLoadedReplyPages(false);
    setReplyStatus({ message: '', visible: false });
    setFocusReplyId(null);
    setPendingCreatedReplyId(null);
    setAutoLoadFailedReplyId(null);
    setIsRetryingReplies(false);
    setHighlightedReplyId(null);
    setConfirmingDelete(null);
    setRestoreDeleteFocus(null);
    setDeleteError(null);
    setPendingLoadedReplyFocusId(null);
    setRestoreLoadMoreButtonFocus(false);
    void utils.forum.replies.list.reset({ topicId, limit: 20 });
    // `utils` is intentionally omitted. tRPC v11 useUtils() is referentially
    // stable; including it reset loaded reply pages whenever a render handed
    // back a new utils object (the forum-detail test mock does that).
  }, [topicId]);

  useEffect(() => {
    if (!confirmingDelete) return;
    cancelDeleteButtonRef.current?.focus();
  }, [confirmingDelete]);

  useEffect(() => {
    if (!restoreDeleteFocus || confirmingDelete) return;
    if (restoreDeleteFocus.kind === 'topic') {
      topicDeleteButtonRef.current?.focus();
    } else {
      replyDeleteButtonRefs.current.get(restoreDeleteFocus.id)?.focus();
    }
    setRestoreDeleteFocus(null);
  }, [confirmingDelete, restoreDeleteFocus, visibleReplies]);

  useEffect(() => {
    if (replyStatus.visible) {
      replyStatusRef.current?.focus();
    }
  }, [replyStatus.visible, replyStatus.message]);

  useEffect(() => {
    if (!restorePinFocus || setPinned.isPending) return;
    pinButtonRef.current?.focus();
    setRestorePinFocus(false);
  }, [restorePinFocus, setPinned.isPending]);

  useEffect(() => {
    const state = location.state as { notice?: string } | null;
    if (state?.notice !== 'topicEdited') return;
    setTopicError('');
    setTopicNotice(t(locale.locale, 'forum.detail.topicEdited'));
    window.setTimeout(() => topicNoticeRef.current?.focus(), 0);
    navigate('.', { replace: true, state: null });
  }, [location.state, locale.locale, navigate]);

  useEffect(() => {
    if (!focusReplyId) return;
    const node = replyRefs.current.get(focusReplyId);
    if (!node) return;
    node.focus();
    setHighlightedReplyId(focusReplyId);
    setFocusReplyId(null);
  }, [focusReplyId, visibleReplies]);

  useEffect(() => {
    if (!pendingLoadedReplyFocusId) return;
    const node = replyRefs.current.get(pendingLoadedReplyFocusId);
    if (node) node.focus();
    // Clear even when the row never mounts. A leftover id would focus a later
    // reply that reuses it (nothing renderable, or the item was removed).
    setPendingLoadedReplyFocusId(null);
  }, [pendingLoadedReplyFocusId, visibleReplies]);

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
  const deletingTopic = deleteTopic.isPending && confirmingDelete?.kind === 'topic';

  useEffect(() => {
    if (showLoadMoreError) {
      retryButtonRef.current?.focus();
    }
  }, [showLoadMoreError]);

  useEffect(() => {
    if (!restoreLoadMoreButtonFocus || isLoadingMoreReplies) return;
    const button = loadMoreButtonRef.current;
    if (button && !button.disabled) {
      button.focus();
    }
    setRestoreLoadMoreButtonFocus(false);
  }, [isLoadingMoreReplies, restoreLoadMoreButtonFocus]);

  useEffect(() => {
    const topic = topicQuery.data;
    if (!topic || session.user?.id !== topic.author.id || session.isBanned) {
      setShowEditAction(false);
      return;
    }
    const serverOffsetMs = Date.parse(topic.serverNow) - Date.now();
    const editableUntilMs = Date.parse(topic.editableUntil);
    const update = () => {
      const stillEditable = Date.now() + serverOffsetMs < editableUntilMs;
      setShowEditAction(stillEditable);
      if (!stillEditable && document.activeElement === editLinkRef.current) {
        titleRef.current?.focus();
      }
      return stillEditable;
    };
    if (!update()) return;
    const delay = Math.max(0, editableUntilMs - (Date.now() + serverOffsetMs));
    const timeout = window.setTimeout(update, delay);
    return () => window.clearTimeout(timeout);
  }, [session.isBanned, session.user?.id, topicQuery.data]);

  if (topicQuery.isLoading) {
    return (
      <PageShell>
        <PageMeta title={tt('state.loading')} />
        <div className="space-y-4">
          <div className="h-6 w-1/3 animate-pulse motion-reduce:animate-none rounded bg-neutral-200" />
          <div className="h-32 animate-pulse motion-reduce:animate-none rounded-2xl bg-white/60" />
        </div>
      </PageShell>
    );
  }

  if (topicQuery.isError || !topicQuery.data) {
    const isNotFound = topicQuery.error?.data?.code === 'NOT_FOUND';
    return (
      <PageShell>
        <PageMeta title={slug} />
        <div className="space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('forum.list.title'), to: '/forum' },
              { label: slug },
            ]}
          />
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            {isNotFound
              ? tt('state.notFound')
              : appErrorMessage(locale.locale, topicQuery.error?.data?.appCode)}
          </p>
        </div>
      </PageShell>
    );
  }

  const topic = topicQuery.data;
  const isOwner = session.user?.id === topic.author.id;
  const canDeleteTopic = isOwner || session.isAdmin;
  const editableUntilTime = new Date(topic.editableUntil).toLocaleTimeString(locale.locale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const onSubmitReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReplyError(null);
    clearDeleteState();
    const parsed = replyBodySchema.safeParse(replyBody);
    if (!parsed.success) {
      setReplyError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
    createReply.mutate({ topicId: topic.id, body: parsed.data });
  };

  const onLoadMoreReplies = async () => {
    const beforeIds = new Set(visibleReplies.map((reply) => reply.id));
    clearDeleteState();
    setShowLoadedReplyPages(true);
    setAutoLoadFailedReplyId(null);
    const result = await fetchNextRepliesPage('manual');
    if (!result) return;
    const pages = result.data?.pages ?? [];
    const mergedLoadedReplies = mergeReplies(pages.flatMap((page) => page.items));
    const newReplies = mergedLoadedReplies.filter((reply) => !beforeIds.has(reply.id));
    if (newReplies.length > 0) {
      setReplyStatus({
        message: tt('forum.detail.repliesLoaded', { count: newReplies.length }),
        visible: false,
      });
    }
    const hasNextPageAfterFetch = Boolean(pages.at(-1)?.nextCursor);
    if (newReplies[0]) {
      if (hasNextPageAfterFetch) {
        // The button is still disabled while this fetch's loading flag is
        // true, so focusing it drops focus to <body>. The new row is
        // focusable (tabIndex=-1) once it commits.
        // Must be set only after this page is in the query cache, or focus cannot find that reply's ref.
        setPendingLoadedReplyFocusId(newReplies[0].id);
      } else {
        setFocusReplyId(newReplies[0].id);
      }
    } else if (hasNextPageAfterFetch) {
      setRestoreLoadMoreButtonFocus(true);
    }
  };

  return (
    <PageShell>
      <PageMeta title={topic.title} />
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('forum.list.title'), to: '/forum' },
            { label: topic.title },
          ]}
        />

        <Card
          className="border-white/60 bg-white/80 backdrop-blur"
          aria-busy={deletingTopic || undefined}
        >
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {topic.pinned ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                    <Pin className="size-3" aria-hidden />
                    {tt('forum.badge.pinned')}
                  </span>
                ) : null}
                <CardTitle ref={titleRef} tabIndex={-1} className="text-2xl">
                  {topic.title}
                </CardTitle>
              </div>
              {confirmingDelete?.kind !== 'topic' ? (
                <div className="flex items-center gap-2">
                  {!isOwner ? <ReportButton targetType="TOPIC" targetId={topic.id} /> : null}
                  {showEditAction ? (
                    <Link
                      ref={editLinkRef}
                      to="edit"
                      aria-label={tt('forum.detail.editAria')}
                      onClick={clearTopicFeedback}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {tt('forum.detail.edit')}
                    </Link>
                  ) : null}
                  {session.isAdmin ? (
                    <button
                      ref={pinButtonRef}
                      type="button"
                      onClick={() => {
                        clearTopicFeedback();
                        setPinned.mutate({ id: topic.id, pinned: !topic.pinned });
                      }}
                      disabled={setPinned.isPending}
                      className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
                    >
                      {setPinned.isPending
                        ? topic.pinned
                          ? tt('forum.detail.unpinning')
                          : tt('forum.detail.pinning')
                        : topic.pinned
                          ? tt('forum.detail.unpin')
                          : tt('forum.detail.pin')}
                    </button>
                  ) : null}
                  {canDeleteTopic ? (
                    <button
                      ref={topicDeleteButtonRef}
                      type="button"
                      onClick={() => {
                        clearTopicFeedback();
                        setConfirmingDelete({ kind: 'topic' });
                      }}
                      disabled={deleteTopic.isPending}
                      aria-label={tt('forum.detail.deleteTopicAria')}
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
                    >
                      {tt('forum.detail.delete')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">@{topic.author.username}</span>
              <time dateTime={topic.createdAt} className="whitespace-nowrap">
                {new Date(topic.createdAt).toLocaleString(locale.locale)}
              </time>
              {topic.editedAt ? (
                <span className="text-neutral-600">
                  · {tt('forum.detail.edited')}
                  <time dateTime={topic.editedAt} className="sr-only">
                    {new Date(topic.editedAt).toLocaleString(locale.locale)}
                  </time>
                </span>
              ) : null}
              {showEditAction ? (
                <span className="text-neutral-600">
                  · {tt('forum.detail.editableUntil', { time: editableUntilTime })}
                </span>
              ) : null}
            </div>
            <p
              ref={topicNoticeRef}
              role="status"
              tabIndex={-1}
              className={
                topicNotice
                  ? 'mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
                  : 'sr-only'
              }
            >
              {topicNotice}
            </p>
            {topicError ? (
              <p
                role="alert"
                className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {topicError}
              </p>
            ) : null}
            {confirmingDelete?.kind === 'topic' ? (
              <DeleteConfirmGroup
                label={tt('forum.detail.confirmDelete')}
                dangerLabel={
                  deletingTopic ? tt('forum.detail.deleting') : tt('forum.detail.delete')
                }
                cancelLabel={tt('forum.detail.deleteCancel')}
                disabled={deletingTopic}
                showReason={session.isAdmin && session.user?.id !== topic.author.id}
                cancelRef={cancelDeleteButtonRef}
                onConfirm={(reason) =>
                  deleteTopic.mutate(reason ? { id: topic.id, reason } : { id: topic.id })
                }
                onCancel={() => {
                  setConfirmingDelete(null);
                  focusDeleteButton({ kind: 'topic' });
                }}
              />
            ) : null}
            {deleteError?.kind === 'topic' ? (
              <p
                role="alert"
                className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {deleteError.message}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            <MarkdownView body={topic.body} />
          </CardContent>
        </Card>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">
            {tt('forum.detail.repliesTitle', { count: topic.replyCount })}
          </h2>
          <p
            ref={replyStatusRef}
            role="status"
            tabIndex={-1}
            className={
              replyStatus.visible
                ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
                : 'sr-only'
            }
          >
            {replyStatus.message}
          </p>

          {visibleReplies.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-200 bg-white/60 p-4 text-center text-sm text-neutral-500">
              {tt('forum.detail.noReplies')}
            </p>
          ) : (
            <ul className="space-y-3">
              {visibleReplies.map((reply) => {
                const canDelete = session.user?.id === reply.author.id || session.isAdmin;
                const confirmingThisReply =
                  confirmingDelete?.kind === 'reply' && confirmingDelete.id === reply.id;
                const deletingThisReply = deleteReply.isPending && confirmingThisReply;
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
                    aria-busy={deletingThisReply || undefined}
                    className={`rounded-2xl border p-4 backdrop-blur transition-colors ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none ${
                      highlightedReplyId === reply.id
                        ? 'border-brand-200 bg-brand-50 duration-0'
                        : 'border-white/60 bg-white/80 duration-1000'
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
                        {canDelete && !confirmingThisReply ? (
                          <button
                            ref={(node) => {
                              if (node) {
                                replyDeleteButtonRefs.current.set(reply.id, node);
                              } else {
                                replyDeleteButtonRefs.current.delete(reply.id);
                              }
                            }}
                            type="button"
                            onClick={() => {
                              clearDeleteState();
                              setConfirmingDelete({ kind: 'reply', id: reply.id });
                            }}
                            aria-label={tt('forum.detail.deleteReplyAria', {
                              user: reply.author.username,
                            })}
                            className="inline-flex min-h-6 items-center rounded px-1 text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:no-underline"
                          >
                            {tt('forum.detail.delete')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 min-w-0">
                      <MarkdownView body={reply.body} />
                    </div>
                    {confirmingThisReply ? (
                      <DeleteConfirmGroup
                        label={tt('forum.detail.confirmDeleteReply')}
                        dangerLabel={
                          deletingThisReply
                            ? tt('forum.detail.deleting')
                            : tt('forum.detail.delete')
                        }
                        cancelLabel={tt('forum.detail.deleteCancel')}
                        disabled={deletingThisReply}
                        showReason={session.isAdmin && session.user?.id !== reply.author.id}
                        cancelRef={cancelDeleteButtonRef}
                        onConfirm={(reason) =>
                          deleteReply.mutate(reason ? { id: reply.id, reason } : { id: reply.id })
                        }
                        onCancel={() => {
                          setConfirmingDelete(null);
                          focusDeleteButton({ kind: 'reply', id: reply.id });
                        }}
                      />
                    ) : null}
                    {deleteError?.kind === 'reply' && deleteError.id === reply.id ? (
                      <p
                        role="alert"
                        className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                      >
                        {deleteError.message}
                      </p>
                    ) : null}
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

          {session.isAuthenticated && session.isBanned ? (
            <BannedNotice>{tt('ban.cannotReply')}</BannedNotice>
          ) : session.isAuthenticated ? (
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
                onChange={(e) => {
                  setReplyBody(e.target.value);
                  clearDeleteState();
                }}
                placeholder={tt('forum.detail.replyPlaceholder')}
                rows={4}
                maxLength={5000}
                className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              {replyError ? (
                <p
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
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

function DeleteConfirmGroup({
  label,
  dangerLabel,
  cancelLabel,
  disabled,
  showReason = false,
  cancelRef,
  onConfirm,
  onCancel,
}: {
  label: string;
  dangerLabel: string;
  cancelLabel: string;
  disabled: boolean;
  showReason?: boolean;
  cancelRef: RefObject<HTMLButtonElement | null>;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const { locale } = useStores();
  const promptId = useId();
  const [reason, setReason] = useState('');
  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!disabled) {
            onCancel();
          }
        }
      }}
      className={
        showReason
          ? 'mt-2 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
          : 'mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
      }
    >
      <span id={promptId} className={showReason ? 'text-red-700' : 'mr-auto text-red-700'}>
        {label}
      </span>
      {showReason ? (
        <DeleteReasonField
          locale={locale.locale}
          value={reason}
          readOnly={disabled}
          onChange={setReason}
        />
      ) : null}
      <div className={showReason ? 'flex justify-end gap-3' : 'contents'}>
        <button
          type="button"
          aria-describedby={promptId}
          disabled={disabled}
          onClick={() => {
            const trimmed = reason.trim();
            onConfirm(showReason && trimmed ? trimmed : undefined);
          }}
          className="inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
        >
          {dangerLabel}
        </button>
        <button
          ref={cancelRef}
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className="inline-flex min-h-6 items-center rounded px-1 text-neutral-600 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
