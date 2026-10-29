import { observer } from 'mobx-react-lite';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router';
import { Button } from '@repo/ui-web';
import {
  APP_ERROR_CODES,
  commentInput,
  fieldErrorMessage,
  isBlankReplyContent,
  seriesCommentInput,
  t,
} from '@repo/shared';
import { useStores } from '../stores/root-store';
import { useAppMutationError } from '../lib/app-mutation-error';
import { trpc } from '../lib/trpc';
import { BannedNotice } from './banned-notice';
import { dataErrorRetryClassName, ErrorBox } from './error-box';
import { DeleteReasonField } from './delete-reason-field';
import { ReportButton } from './report-button';
import { queryFallback, RetryButton, useFocusOnRecovery } from './retry-button';

type CommentTarget = { kind: 'card'; slug: string } | { kind: 'series'; slug: string };

interface CommentSectionProps {
  target: CommentTarget;
}

interface CommentUser {
  id: string;
  username: string;
}

interface ReplyItem {
  id: string;
  content: string;
  createdAt: string;
  user: CommentUser;
}

interface ThreadComment extends ReplyItem {
  replyCount?: number;
  replies?: ReplyItem[];
  repliesNextCursor?: string | null;
}

interface ThreadOverlay {
  appended: ReplyItem[];
  removed: string[];
  countDelta: number;
  cursor: string | null | undefined;
}

const replyActionClassName =
  'inline-flex min-h-6 scroll-mt-20 items-center rounded px-1 text-xs font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

const MENTION = /^@([A-Za-z0-9_-]+) /;

function emptyOverlay(): ThreadOverlay {
  return { appended: [], removed: [], countDelta: 0, cursor: undefined };
}

function compareReplies(a: ReplyItem, b: ReplyItem) {
  const byTime = a.createdAt.localeCompare(b.createdAt);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

function visibleReplies(comment: ThreadComment, overlay: ThreadOverlay): ReplyItem[] {
  const removed = new Set(overlay.removed);
  const merged = new Map<string, ReplyItem>();
  for (const reply of comment.replies ?? []) {
    if (!removed.has(reply.id)) merged.set(reply.id, reply);
  }
  for (const reply of overlay.appended) {
    if (!removed.has(reply.id)) merged.set(reply.id, reply);
  }
  return [...merged.values()].sort(compareReplies);
}

function visibleReplyCount(comment: ThreadComment, overlay: ThreadOverlay) {
  const base = comment.replyCount ?? comment.replies?.length ?? 0;
  return Math.max(0, base + overlay.countDelta);
}

/** A mention-only prefill counts as empty, same as a blank reply. */
function rememberReplyDraft(
  drafts: Record<string, string>,
  parentId: string,
  value: string,
  prefillUsernames: readonly string[],
) {
  if (isBlankReplyContent(value, prefillUsernames)) delete drafts[parentId];
  else drafts[parentId] = value;
}

/** A blank draft falls back to `@author `; a top-level reply has no prefill. */
function replyComposerValue(saved: string | undefined, prefill: string | null) {
  if (saved?.trim()) return saved;
  return prefill ? `@${prefill} ` : '';
}

function resolveCursor(
  comment: ThreadComment,
  overlay: ThreadOverlay,
  visible: ReplyItem[],
  count: number,
): string | null {
  const cursor =
    overlay.cursor === undefined ? (comment.repliesNextCursor ?? null) : overlay.cursor;
  if (count <= visible.length) return null;
  if (!cursor || overlay.removed.includes(cursor)) return visible.at(-1)?.id ?? null;
  return cursor;
}

function CommentText({ content }: { content: string }) {
  const match = MENTION.exec(content);
  if (!match) return content;
  const mention = `@${match[1]}`;
  return (
    <>
      <span className="font-medium text-brand-700">{mention}</span>
      {content.slice(mention.length)}
    </>
  );
}

function formatDateTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Three rows in the same shape as a comment card: author line, then body. */
function CommentListSkeleton({ label }: { label: string }) {
  return (
    <>
      <p className="sr-only">{label}</p>
      <ul className="space-y-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <li
            key={index}
            className="rounded-xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur"
          >
            <div className="flex h-6 items-center">
              <div className="h-3 w-24 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
            </div>
            <div className="mt-2 flex h-5 items-center">
              <div className="h-4 w-full animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export const CommentSection = observer(function CommentSection({ target }: CommentSectionProps) {
  const commentTarget = target;
  const { locale, session } = useStores();
  const presentError = useAppMutationError();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const cardList = trpc.comments.listForCard.useQuery(
    { cardSlug: commentTarget.kind === 'card' ? commentTarget.slug : '' },
    { enabled: commentTarget.kind === 'card' && !!commentTarget.slug },
  );
  const seriesList = trpc.comments.listForSeries.useQuery(
    { seriesSlug: commentTarget.kind === 'series' ? commentTarget.slug : '' },
    { enabled: commentTarget.kind === 'series' && !!commentTarget.slug },
  );
  const list = commentTarget.kind === 'card' ? cardList : seriesList;
  const utils = trpc.useUtils();
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusVisible, setStatusVisible] = useState(false);
  const [threads, setThreads] = useState<Record<string, ThreadOverlay>>({});
  const [openParentId, setOpenParentId] = useState<string | null>(null);
  const [openerKey, setOpenerKey] = useState<string | null>(null);
  const [composerUser, setComposerUser] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyPending, setReplyPending] = useState(false);
  const [parentGone, setParentGone] = useState<string | null>(null);
  const [loadingParentId, setLoadingParentId] = useState<string | null>(null);
  const [failedParentId, setFailedParentId] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const commentsRef = useRef<HTMLElement | null>(null);
  const deleteButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cancelButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const replyButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const replyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const draftsRef = useRef<Record<string, string>>({});
  const openParentRef = useRef<string | null>(null);
  const pendingFocus = useRef<{ type: 'opener' | 'show-more' | 'title'; id: string } | null>(null);
  const replyRetryRef = useRef<HTMLButtonElement>(null);
  const focusRetryParentId = useRef<string | null>(null);
  const [replyFocusId, setReplyFocusId] = useState<string | null>(null);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const canReply = session.isAuthenticated && !session.isBanned;

  function invalidateList() {
    if (commentTarget.kind === 'card') {
      void utils.comments.listForCard.invalidate({ cardSlug: commentTarget.slug });
    } else {
      void utils.comments.listForSeries.invalidate({ seriesSlug: commentTarget.slug });
    }
  }

  function showStatus(message: string, visible: boolean) {
    setStatusVisible(visible);
    setStatusMessage(message);
  }

  function threadOf(comment: ThreadComment) {
    return threads[comment.id] ?? emptyOverlay();
  }

  function parentOfReply(replyId: string): string | null {
    for (const item of (list.data ?? []) as ThreadComment[]) {
      if ((item.replies ?? []).some((reply) => reply.id === replyId)) return item.id;
      if ((threads[item.id]?.appended ?? []).some((reply) => reply.id === replyId)) return item.id;
    }
    return null;
  }

  function ownerOf(id: string): string | undefined {
    for (const item of (list.data ?? []) as ThreadComment[]) {
      if (item.id === id) return item.user.id;
      const reply = visibleReplies(item, threadOf(item)).find((entry) => entry.id === id);
      if (reply) return reply.user.id;
    }
    return undefined;
  }

  const handleCreateSuccess = () => {
    setContent('');
    invalidateList();
  };

  const handleCreateError = (err: unknown) => {
    const message = presentError(err, {
      [APP_ERROR_CODES.TOO_MANY_REQUESTS]: tt('card.detail.commentRateLimited'),
    });
    if (message) setError(message);
  };

  function handleReplySuccess(parentId: string, created: ReplyItem) {
    delete draftsRef.current[parentId];
    openParentRef.current = null;
    setOpenParentId(null);
    setReplyDraft('');
    setReplyError(null);
    setThreads((current) => {
      const prev = current[parentId] ?? emptyOverlay();
      if (prev.appended.some((reply) => reply.id === created.id)) return current;
      return {
        ...current,
        [parentId]: {
          ...prev,
          appended: [...prev.appended, created],
          countDelta: prev.countDelta + 1,
        },
      };
    });
    showStatus(tt('comment.reply.posted'), false);
    setReplyFocusId(created.id);
  }

  function prefillUsernames(parentId: string) {
    const comment = ((list.data ?? []) as ThreadComment[]).find((item) => item.id === parentId);
    if (!comment) return [];
    return visibleReplies(comment, threadsRef.current[comment.id] ?? emptyOverlay()).map(
      (reply) => reply.user.username,
    );
  }

  function handleReplyError(err: unknown) {
    const appCode =
      typeof err === 'object' && err !== null && 'data' in err
        ? (err.data as { appCode?: unknown }).appCode
        : undefined;
    if (appCode === APP_ERROR_CODES.COMMENT_PARENT_GONE) {
      if (openParentRef.current) {
        rememberReplyDraft(
          draftsRef.current,
          openParentRef.current,
          replyDraft,
          prefillUsernames(openParentRef.current),
        );
      }
      openParentRef.current = null;
      setOpenParentId(null);
      setReplyError(null);
      setParentGone(tt('comment.reply.parentGone'));
      invalidateList();
      pendingFocus.current = { type: 'title', id: 'comment-section-title' };
      return;
    }
    const message = presentError(err, {
      [APP_ERROR_CODES.TOO_MANY_REQUESTS]: tt('card.detail.commentRateLimited'),
    });
    if (message) setReplyError(message);
  }

  const createForCard = trpc.comments.create.useMutation({
    onSuccess(created, variables) {
      if (variables?.parentId) {
        setReplyPending(false);
        handleReplySuccess(variables.parentId, created);
        return;
      }
      handleCreateSuccess();
    },
    onError(err, variables) {
      if (variables?.parentId) {
        setReplyPending(false);
        handleReplyError(err);
        return;
      }
      handleCreateError(err);
    },
  });

  const createForSeries = trpc.comments.createForSeries.useMutation({
    onSuccess(created, variables) {
      if (variables?.parentId) {
        setReplyPending(false);
        handleReplySuccess(variables.parentId, created);
        return;
      }
      handleCreateSuccess();
    },
    onError(err, variables) {
      if (variables?.parentId) {
        setReplyPending(false);
        handleReplyError(err);
        return;
      }
      handleCreateError(err);
    },
  });

  function finishTopLevelDelete(comment: ThreadComment) {
    const count = visibleReplyCount(comment, threadOf(comment));
    setConfirmingId(null);
    setDeleteReason('');
    setDeleteError(null);
    showStatus(
      count > 0 ? tt('comment.deletedWithReplies', { count }) : tt('card.detail.commentDeleted'),
      true,
    );
    invalidateList();
  }

  function finishReplyDelete() {
    setConfirmingId(null);
    setDeleteReason('');
    setDeleteError(null);
    showStatus(tt('comment.reply.deleted'), true);
  }

  function noteReplyRemoved(replyId: string) {
    const parentId = parentOfReply(replyId);
    if (!parentId) return;
    setThreads((current) => {
      const prev = current[parentId] ?? emptyOverlay();
      if (prev.removed.includes(replyId)) return current;
      return {
        ...current,
        [parentId]: {
          ...prev,
          removed: [...prev.removed, replyId],
          countDelta: prev.countDelta - 1,
        },
      };
    });
  }

  const deleteComment = trpc.comments.delete.useMutation({
    onSuccess(_data, variables) {
      const id = variables?.id ?? confirmingId;
      if (!id) return;
      const top = ((list.data ?? []) as ThreadComment[]).find((item) => item.id === id);
      if (!top) {
        noteReplyRemoved(id);
        finishReplyDelete();
        return;
      }
      finishTopLevelDelete(top);
    },
    onError(err, variables) {
      const code = err.data?.code;
      if (code === 'NOT_FOUND') {
        const top = ((list.data ?? []) as ThreadComment[]).find((item) => item.id === variables.id);
        if (top) finishTopLevelDelete(top);
        else {
          noteReplyRemoved(variables.id);
          finishReplyDelete();
        }
        return;
      }

      const ownerId = ownerOf(variables.id);
      const keepReason = session.isAdmin && ownerId !== undefined && session.user?.id !== ownerId;
      setDeleteError({
        id: variables.id,
        message:
          code === 'FORBIDDEN'
            ? tt('card.detail.commentDeleteForbidden')
            : tt('card.detail.commentDeleteFailed'),
      });
      if (keepReason) return;
      setConfirmingId(null);
      setDeleteReason('');
      restoreDeleteFocus(variables.id);
    },
  });

  useEffect(() => {
    if (!confirmingId) return;
    cancelButtonRefs.current[confirmingId]?.focus();
  }, [confirmingId]);

  useEffect(() => {
    if (!statusMessage || !statusVisible) return;
    statusRef.current?.focus();
  }, [statusMessage, statusVisible]);

  const renderedReplyIds = ((list.data ?? []) as ThreadComment[])
    .flatMap((comment) => visibleReplies(comment, threads[comment.id] ?? emptyOverlay()))
    .map((reply) => reply.id)
    .join('\n');

  useLayoutEffect(() => {
    if (!replyFocusId || !renderedReplyIds.split('\n').includes(replyFocusId)) return;
    const node = document.getElementById(`reply-${replyFocusId}`);
    if (!node) return;
    node.focus();
    setReplyFocusId(null);
  }, [replyFocusId, renderedReplyIds]);

  useLayoutEffect(() => {
    const parentId = focusRetryParentId.current;
    if (!parentId || failedParentId !== parentId || loadingParentId === parentId) return;
    const node = replyRetryRef.current;
    if (!node) return;
    focusRetryParentId.current = null;
    node.focus({ preventScroll: true });
  }, [failedParentId, loadingParentId]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const node =
      pending.type === 'title'
        ? document.getElementById(pending.id)
        : pending.type === 'opener'
          ? replyButtonRefs.current[pending.id]
          : document.getElementById(`show-more-${pending.id}`);
    if (!node) return;
    pendingFocus.current = null;
    node.focus();
  });

  useEffect(() => {
    if (!openParentId) return;
    const node = replyInputRef.current;
    if (!node) return;
    node.focus();
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }, [openParentId, openerKey]);

  const isCreating = (createForCard.isPending || createForSeries.isPending) && !replyPending;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatusMessage('');

    if (commentTarget.kind === 'card') {
      const parsed = commentInput.safeParse({ cardSlug: commentTarget.slug, content });
      if (!parsed.success) {
        setError(
          parsed.error.issues[0]
            ? fieldErrorMessage(locale.locale, parsed.error.issues[0].message)
            : '',
        );
        return;
      }
      createForCard.mutate(parsed.data);
      return;
    }

    const parsed = seriesCommentInput.safeParse({ seriesSlug: commentTarget.slug, content });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]
          ? fieldErrorMessage(locale.locale, parsed.error.issues[0].message)
          : '',
      );
      return;
    }
    createForSeries.mutate(parsed.data);
  };

  function restoreDeleteFocus(commentId: string) {
    window.requestAnimationFrame(() => deleteButtonRefs.current[commentId]?.focus());
  }

  const cancelDelete = (commentId: string) => {
    setConfirmingId(null);
    setDeleteReason('');
    restoreDeleteFocus(commentId);
  };

  const onConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>, commentId: string) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancelDelete(commentId);
    }
  };

  function openReply(
    parentId: string,
    sourceId: string,
    labelUser: string,
    prefill: string | null,
  ) {
    if (openParentRef.current) {
      rememberReplyDraft(
        draftsRef.current,
        openParentRef.current,
        replyDraft,
        prefillUsernames(openParentRef.current),
      );
    }
    const next = replyComposerValue(draftsRef.current[parentId], prefill);
    openParentRef.current = parentId;
    setOpenParentId(parentId);
    setOpenerKey(`${parentId}:${sourceId}`);
    setComposerUser(labelUser);
    setReplyDraft(next);
    setReplyError(null);
    setParentGone(null);
  }

  function closeReply(restore: boolean) {
    if (openParentRef.current) {
      rememberReplyDraft(
        draftsRef.current,
        openParentRef.current,
        replyDraft,
        prefillUsernames(openParentRef.current),
      );
    }
    const key = openerKey;
    openParentRef.current = null;
    setOpenParentId(null);
    setReplyError(null);
    if (restore && key) pendingFocus.current = { type: 'opener', id: key };
  }

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openParentId || replyPending) return;
    const comment = ((list.data ?? []) as ThreadComment[]).find((item) => item.id === openParentId);
    const names = comment
      ? visibleReplies(comment, threadsRef.current[comment.id] ?? emptyOverlay()).map(
          (reply) => reply.user.username,
        )
      : [];
    if (isBlankReplyContent(replyDraft, names)) {
      setReplyError(tt('comment.reply.empty'));
      replyInputRef.current?.focus();
      return;
    }
    setReplyError(null);
    setReplyPending(true);
    if (commentTarget.kind === 'card') {
      const parsed = commentInput.safeParse({
        cardSlug: commentTarget.slug,
        content: replyDraft,
        parentId: openParentId,
      });
      if (!parsed.success) {
        setReplyPending(false);
        setReplyError(tt('error.app.VALIDATION'));
        return;
      }
      createForCard.mutate(parsed.data);
      return;
    }
    const parsed = seriesCommentInput.safeParse({
      seriesSlug: commentTarget.slug,
      content: replyDraft,
      parentId: openParentId,
    });
    if (!parsed.success) {
      setReplyPending(false);
      setReplyError(tt('error.app.VALIDATION'));
      return;
    }
    createForSeries.mutate(parsed.data);
  }

  async function loadMore(parentId: string) {
    const comment = ((list.data ?? []) as ThreadComment[]).find((item) => item.id === parentId);
    if (!comment) return;
    const overlay = threadsRef.current[parentId] ?? emptyOverlay();
    const visible = visibleReplies(comment, overlay);
    const count = visibleReplyCount(comment, overlay);
    const cursor = resolveCursor(comment, overlay, visible, count);
    if (!cursor) return;
    const active = document.activeElement;
    const showMore = document.getElementById(`show-more-${parentId}`);
    const restoreRetryFocus = active === showMore || active === replyRetryRef.current;
    setLoadingParentId(parentId);
    try {
      const page = await utils.comments.listReplies.fetch({ parentId, cursor, limit: 20 });
      const known = new Set(visible.map((reply) => reply.id));
      const fresh = page.items.filter((item) => !known.has(item.id));
      setThreads((current) => {
        const prev = current[parentId] ?? emptyOverlay();
        const appended = [...prev.appended];
        const seen = new Set(appended.map((reply) => reply.id));
        for (const item of page.items) {
          if (!seen.has(item.id)) appended.push(item);
        }
        return {
          ...current,
          [parentId]: { ...prev, appended, cursor: page.nextCursor },
        };
      });
      showStatus(tt('comment.reply.loaded', { count: fresh.length }), false);
      focusRetryParentId.current = null;
      setFailedParentId((current) => (current === parentId ? null : current));
      if (page.nextCursor) pendingFocus.current = { type: 'show-more', id: parentId };
      else if (fresh[0]) setReplyFocusId(fresh[0].id);
    } catch {
      setFailedParentId(parentId);
      if (restoreRetryFocus) focusRetryParentId.current = parentId;
    } finally {
      setLoadingParentId((current) => (current === parentId ? null : current));
    }
  }

  const commentsView = queryFallback(list);
  useFocusOnRecovery(commentsView, commentsRef);

  const commentsLoading = commentsView === 'loading';

  return (
    <div className="space-y-4" aria-busy={commentsLoading ? true : undefined}>
      {session.isAuthenticated && session.isBanned ? (
        <BannedNotice>{tt('ban.cannotComment')}</BannedNotice>
      ) : session.isAuthenticated ? (
        <form
          onSubmit={onSubmit}
          className="space-y-2 rounded-2xl border border-white/60 bg-white/80 p-4 backdrop-blur"
        >
          <label htmlFor="comment-content" className="sr-only">
            {tt('a11y.commentArea')}
          </label>
          <textarea
            id="comment-content"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              if (error) setError(null);
              if (statusMessage) setStatusMessage('');
            }}
            placeholder={tt(
              commentTarget.kind === 'card'
                ? 'card.detail.commentPlaceholder'
                : 'series.detail.commentPlaceholder',
            )}
            rows={3}
            maxLength={500}
            aria-label={tt('a11y.commentArea')}
            className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-600">{content.length} / 500</span>
            <Button type="submit" disabled={isCreating || !content.trim()}>
              {isCreating ? tt('card.detail.commentSubmitting') : tt('card.detail.commentSubmit')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-4 text-center text-sm text-neutral-600 backdrop-blur">
          <Link
            to="/login"
            state={{
              from:
                commentTarget.kind === 'card'
                  ? `/cards/${commentTarget.slug}`
                  : `/series/${commentTarget.slug}`,
            }}
            className="rounded font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {tt('card.detail.loginToComment')}
          </Link>
        </p>
      )}

      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={
          statusMessage && statusVisible
            ? 'scroll-mt-20 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
            : 'sr-only'
        }
      >
        {statusMessage}
      </p>
      {parentGone ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {parentGone}
        </p>
      ) : null}

      {commentsView === 'error' ? (
        <ErrorBox
          title={tt('card.detail.commentsLoadFailed')}
          retryLabel={tt('state.retry')}
          retryingLabel={tt('state.retrying')}
          retrying={list.isFetching}
          retry={() => {
            void list.refetch();
          }}
          retryClassName={dataErrorRetryClassName}
        />
      ) : commentsLoading ? (
        <CommentListSkeleton label={tt('a11y.loading')} />
      ) : !list.data || list.data.length === 0 ? (
        <p
          ref={(node) => {
            commentsRef.current = node;
          }}
          tabIndex={-1}
          className="scroll-mt-20 rounded-md border border-dashed border-neutral-200 bg-white/60 p-4 text-center text-sm text-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {tt('card.detail.commentEmpty')}
        </p>
      ) : (
        <ul
          ref={(node) => {
            commentsRef.current = node;
          }}
          tabIndex={-1}
          aria-label={tt('a11y.commentList')}
          className="space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {list.data.map((comment) => {
            const thread = comment as ThreadComment;
            const overlay = threadOf(thread);
            const replies = visibleReplies(thread, overlay);
            const replyCount = visibleReplyCount(thread, overlay);
            const cursor = resolveCursor(thread, overlay, replies, replyCount);
            const remaining = Math.max(0, replyCount - replies.length);
            const confirmPrompt =
              replyCount > 0
                ? tt('comment.confirmDeleteWithReplies', { count: replyCount })
                : tt('card.detail.confirmDeleteComment');
            const canDelete = session.user?.id === comment.user.id || session.isAdmin;
            const showDeleteReason = session.isAdmin && session.user?.id !== comment.user.id;
            const isConfirming = confirmingId === comment.id;
            const isDeleting =
              deleteComment.isPending && deleteComment.variables?.id === comment.id;
            const replyKey = `${comment.id}:${comment.id}`;
            const composerOpen = openParentId === comment.id;
            const inputId = `reply-content-${comment.id}`;

            return (
              <li
                key={comment.id}
                aria-busy={isDeleting ? true : undefined}
                className="rounded-xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur"
              >
                <div className="flex min-h-6 items-center justify-between gap-x-3 text-xs text-neutral-600">
                  <span
                    title={`@${comment.user.username}`}
                    className="min-w-0 truncate font-semibold text-neutral-900"
                  >
                    @{comment.user.username}
                  </span>
                  <time dateTime={comment.createdAt} className="ml-auto whitespace-nowrap">
                    {formatDateTime(comment.createdAt, locale.locale)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 wrap-anywhere">
                  {comment.content}
                </p>
                <ReportButton targetType="COMMENT" targetId={comment.id}>
                  {({ trigger, form }) => (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {canReply ? (
                          <button
                            type="button"
                            ref={(node) => {
                              replyButtonRefs.current[replyKey] = node;
                            }}
                            aria-expanded={composerOpen && openerKey === replyKey}
                            aria-controls={inputId}
                            aria-label={tt('comment.replyAria', { user: comment.user.username })}
                            onClick={() =>
                              openReply(comment.id, comment.id, comment.user.username, null)
                            }
                            className={replyActionClassName}
                          >
                            {tt('comment.reply')}
                          </button>
                        ) : null}
                        {!isConfirming && session.user?.id !== comment.user.id ? trigger : null}
                        {!isConfirming && canDelete ? (
                          <button
                            type="button"
                            ref={(node) => {
                              deleteButtonRefs.current[comment.id] = node;
                            }}
                            aria-label={tt('card.detail.commentDeleteAria', {
                              user: comment.user.username,
                            })}
                            onClick={() => {
                              setDeleteError(null);
                              setStatusMessage('');
                              setDeleteReason('');
                              setConfirmingId(comment.id);
                            }}
                            className="inline-flex min-h-6 items-center rounded px-1 text-xs text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                          >
                            {tt('card.detail.commentDelete')}
                          </button>
                        ) : null}
                        {replyCount > 0 ? (
                          <span className="text-xs text-neutral-600">
                            {tt('comment.replyCount', { count: replyCount })}
                          </span>
                        ) : null}
                      </div>
                      {form}
                    </>
                  )}
                </ReportButton>
                {isConfirming ? (
                  <div
                    role="group"
                    aria-label={confirmPrompt}
                    className={
                      showDeleteReason
                        ? 'mt-2 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
                        : 'mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
                    }
                    onKeyDown={(event) => onConfirmKeyDown(event, comment.id)}
                  >
                    <span className={showDeleteReason ? 'text-red-700' : 'mr-auto text-red-700'}>
                      {confirmPrompt}
                    </span>
                    {showDeleteReason ? (
                      <DeleteReasonField
                        locale={locale.locale}
                        value={deleteReason}
                        readOnly={isDeleting}
                        onChange={setDeleteReason}
                      />
                    ) : null}
                    <div className={showDeleteReason ? 'flex justify-end gap-3' : 'contents'}>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => {
                          const reason = deleteReason.trim();
                          deleteComment.mutate(
                            showDeleteReason && reason
                              ? { id: comment.id, reason }
                              : { id: comment.id },
                          );
                        }}
                        className="inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                      >
                        {isDeleting
                          ? tt('card.detail.commentDeleting')
                          : tt('card.detail.commentDelete')}
                      </button>
                      <button
                        type="button"
                        ref={(node) => {
                          cancelButtonRefs.current[comment.id] = node;
                        }}
                        disabled={isDeleting}
                        onClick={() => cancelDelete(comment.id)}
                        className="inline-flex min-h-6 items-center rounded px-1 text-neutral-600 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {tt('card.detail.commentDeleteCancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
                {deleteError?.id === comment.id ? (
                  <p
                    role="alert"
                    className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                  >
                    {deleteError.message}
                  </p>
                ) : null}
                {replies.length > 0 ? (
                  <ul
                    aria-label={tt('comment.repliesListAria', { user: comment.user.username })}
                    className="mt-3 space-y-3 border-l-2 border-neutral-200 pl-3 sm:pl-4"
                  >
                    {replies.map((reply) => {
                      const replyCanDelete = session.user?.id === reply.user.id || session.isAdmin;
                      const replyShowReason = session.isAdmin && session.user?.id !== reply.user.id;
                      const replyConfirming = confirmingId === reply.id;
                      const replyDeleting =
                        deleteComment.isPending && deleteComment.variables?.id === reply.id;
                      const replyOpener = `${comment.id}:${reply.id}`;
                      return (
                        <li
                          key={reply.id}
                          id={`reply-${reply.id}`}
                          tabIndex={-1}
                          aria-busy={replyDeleting ? true : undefined}
                          className="scroll-mt-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          <ReportButton targetType="COMMENT" targetId={reply.id}>
                            {({ trigger, form }) => (
                              <>
                                <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
                                  <span className="font-semibold text-neutral-900 wrap-anywhere">
                                    @{reply.user.username}
                                  </span>
                                  {!replyConfirming ? (
                                    <div className="ml-auto flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
                                      <time
                                        dateTime={reply.createdAt}
                                        className="whitespace-nowrap"
                                      >
                                        {formatDateTime(reply.createdAt, locale.locale)}
                                      </time>
                                      {session.user?.id !== reply.user.id ? trigger : null}
                                      {replyCanDelete ? (
                                        <button
                                          type="button"
                                          ref={(node) => {
                                            deleteButtonRefs.current[reply.id] = node;
                                          }}
                                          aria-label={tt('card.detail.commentDeleteAria', {
                                            user: reply.user.username,
                                          })}
                                          onClick={() => {
                                            setDeleteError(null);
                                            setStatusMessage('');
                                            setDeleteReason('');
                                            setConfirmingId(reply.id);
                                          }}
                                          className="inline-flex min-h-6 items-center rounded px-1 text-xs text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                        >
                                          {tt('card.detail.commentDelete')}
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                                {form}
                              </>
                            )}
                          </ReportButton>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 wrap-anywhere">
                            <CommentText content={reply.content} />
                          </p>
                          {canReply ? (
                            <button
                              type="button"
                              ref={(node) => {
                                replyButtonRefs.current[replyOpener] = node;
                              }}
                              aria-expanded={composerOpen && openerKey === replyOpener}
                              aria-controls={inputId}
                              aria-label={tt('comment.replyAria', { user: reply.user.username })}
                              onClick={() =>
                                openReply(
                                  comment.id,
                                  reply.id,
                                  reply.user.username,
                                  reply.user.username,
                                )
                              }
                              className={`${replyActionClassName} mt-2`}
                            >
                              {tt('comment.reply')}
                            </button>
                          ) : null}
                          {replyConfirming ? (
                            <div
                              role="group"
                              aria-label={tt('comment.reply.confirmDelete')}
                              className={
                                replyShowReason
                                  ? 'mt-2 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
                                  : 'mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs'
                              }
                              onKeyDown={(event) => onConfirmKeyDown(event, reply.id)}
                            >
                              <span
                                className={
                                  replyShowReason ? 'text-red-700' : 'mr-auto text-red-700'
                                }
                              >
                                {tt('comment.reply.confirmDelete')}
                              </span>
                              {replyShowReason ? (
                                <DeleteReasonField
                                  locale={locale.locale}
                                  value={deleteReason}
                                  readOnly={replyDeleting}
                                  onChange={setDeleteReason}
                                />
                              ) : null}
                              <div
                                className={replyShowReason ? 'flex justify-end gap-3' : 'contents'}
                              >
                                <button
                                  type="button"
                                  disabled={replyDeleting}
                                  onClick={() => {
                                    const reason = deleteReason.trim();
                                    deleteComment.mutate(
                                      replyShowReason && reason
                                        ? { id: reply.id, reason }
                                        : { id: reply.id },
                                    );
                                  }}
                                  className="inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                                >
                                  {replyDeleting
                                    ? tt('card.detail.commentDeleting')
                                    : tt('card.detail.commentDelete')}
                                </button>
                                <button
                                  type="button"
                                  ref={(node) => {
                                    cancelButtonRefs.current[reply.id] = node;
                                  }}
                                  disabled={replyDeleting}
                                  onClick={() => cancelDelete(reply.id)}
                                  className="inline-flex min-h-6 items-center rounded px-1 text-neutral-600 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {tt('card.detail.commentDeleteCancel')}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {failedParentId === comment.id ? (
                  <div
                    role="alert"
                    className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                  >
                    <span>{tt('comment.reply.loadFailed')}</span>
                    <RetryButton
                      ref={replyRetryRef}
                      variant="inline"
                      className="scroll-mt-20"
                      retrying={loadingParentId === comment.id}
                      label={tt('state.retry')}
                      retryingLabel={tt('state.retrying')}
                      onRetry={() => void loadMore(comment.id)}
                    />
                  </div>
                ) : remaining > 0 && cursor ? (
                  <button
                    id={`show-more-${comment.id}`}
                    type="button"
                    disabled={loadingParentId === comment.id}
                    aria-busy={loadingParentId === comment.id || undefined}
                    onClick={() => void loadMore(comment.id)}
                    className={`${replyActionClassName} mt-2`}
                  >
                    {loadingParentId === comment.id
                      ? tt('state.loading')
                      : tt('comment.reply.showMore', { count: remaining })}
                  </button>
                ) : null}
                {composerOpen ? (
                  <form
                    onSubmit={submitReply}
                    aria-busy={replyPending || undefined}
                    className="mt-3 space-y-2"
                  >
                    <label htmlFor={inputId} className="sr-only">
                      {tt('comment.replyAria', { user: composerUser })}
                    </label>
                    <textarea
                      ref={replyInputRef}
                      id={inputId}
                      rows={3}
                      maxLength={500}
                      readOnly={replyPending}
                      value={replyDraft}
                      onChange={(event) => {
                        setReplyDraft(event.target.value);
                        if (replyError) setReplyError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          closeReply(true);
                          return;
                        }
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
                      <span className="text-xs text-neutral-600" aria-live="off">
                        {replyDraft.length} / 500
                      </span>
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={replyPending}
                          onClick={() => closeReply(true)}
                        >
                          {tt('comment.reply.cancel')}
                        </Button>
                        <Button type="submit" size="sm" disabled={replyPending}>
                          {replyPending
                            ? tt('comment.reply.submitting')
                            : tt('comment.reply.submit')}
                        </Button>
                      </div>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
