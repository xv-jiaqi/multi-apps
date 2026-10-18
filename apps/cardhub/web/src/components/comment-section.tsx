import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@repo/ui-web';
import { APP_ERROR_CODES, commentInput, seriesCommentInput, t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { useAppMutationError } from '../lib/app-mutation-error';
import { trpc } from '../lib/trpc';
import { dataErrorRetryClassName, ErrorBox } from './error-box';
import { ReportButton } from './report-button';
import { queryFallback, useFocusOnRecovery } from './retry-button';

type CommentTarget = { kind: 'card'; slug: string } | { kind: 'series'; slug: string };

interface CommentSectionProps {
  target: CommentTarget;
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
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const commentsRef = useRef<HTMLElement | null>(null);
  const deleteButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cancelButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleCreateSuccess = () => {
    setContent('');
    if (commentTarget.kind === 'card') {
      void utils.comments.listForCard.invalidate({ cardSlug: commentTarget.slug });
    } else {
      void utils.comments.listForSeries.invalidate({ seriesSlug: commentTarget.slug });
    }
  };

  const handleCreateError = (err: unknown) => {
    const message = presentError(err, {
      [APP_ERROR_CODES.TOO_MANY_REQUESTS]: tt('card.detail.commentRateLimited'),
    });
    if (message) setError(message);
  };

  const createForCard = trpc.comments.create.useMutation({
    onSuccess() {
      handleCreateSuccess();
    },
    onError(err) {
      handleCreateError(err);
    },
  });

  const createForSeries = trpc.comments.createForSeries.useMutation({
    onSuccess() {
      handleCreateSuccess();
    },
    onError(err) {
      handleCreateError(err);
    },
  });

  function markDeleted() {
    setConfirmingId(null);
    setDeleteError(null);
    setStatusMessage(tt('card.detail.commentDeleted'));
    if (commentTarget.kind === 'card') {
      void utils.comments.listForCard.invalidate({ cardSlug: commentTarget.slug });
    } else {
      void utils.comments.listForSeries.invalidate({ seriesSlug: commentTarget.slug });
    }
  }

  const deleteComment = trpc.comments.delete.useMutation({
    onSuccess() {
      markDeleted();
    },
    onError(err, variables) {
      const code = err.data?.code;
      if (code === 'NOT_FOUND') {
        markDeleted();
        return;
      }

      setConfirmingId(null);
      setDeleteError({
        id: variables.id,
        message:
          code === 'FORBIDDEN'
            ? tt('card.detail.commentDeleteForbidden')
            : tt('card.detail.commentDeleteFailed'),
      });
      restoreDeleteFocus(variables.id);
    },
  });

  useEffect(() => {
    if (!confirmingId) return;
    cancelButtonRefs.current[confirmingId]?.focus();
  }, [confirmingId]);

  useEffect(() => {
    if (!statusMessage) return;
    statusRef.current?.focus();
  }, [statusMessage]);

  const isCreating = createForCard.isPending || createForSeries.isPending;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatusMessage('');

    if (commentTarget.kind === 'card') {
      const parsed = commentInput.safeParse({ cardSlug: commentTarget.slug, content });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? '');
        return;
      }
      createForCard.mutate(parsed.data);
      return;
    }

    const parsed = seriesCommentInput.safeParse({ seriesSlug: commentTarget.slug, content });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '');
      return;
    }
    createForSeries.mutate(parsed.data);
  };

  function restoreDeleteFocus(commentId: string) {
    window.requestAnimationFrame(() => deleteButtonRefs.current[commentId]?.focus());
  }

  const cancelDelete = (commentId: string) => {
    setConfirmingId(null);
    restoreDeleteFocus(commentId);
  };

  const onConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>, commentId: string) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancelDelete(commentId);
    }
  };

  const commentsView = queryFallback(list);
  useFocusOnRecovery(commentsView, commentsRef);

  const commentsLoading = commentsView === 'loading';

  return (
    <div className="space-y-4" aria-busy={commentsLoading ? true : undefined}>
      {session.isAuthenticated ? (
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
            className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
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
            <span className="text-xs text-neutral-500">{content.length} / 500</span>
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
            className="font-medium text-brand-600 hover:underline"
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
          statusMessage
            ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
            : 'sr-only'
        }
      >
        {statusMessage}
      </p>

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
          className="rounded-md border border-dashed border-neutral-200 bg-white/60 p-4 text-center text-sm text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
            const canDelete = session.user?.id === comment.user.id || session.isAdmin;
            const isConfirming = confirmingId === comment.id;
            const isDeleting =
              deleteComment.isPending && deleteComment.variables?.id === comment.id;

            return (
              <li
                key={comment.id}
                aria-busy={isDeleting ? true : undefined}
                className="rounded-xl border border-white/60 bg-white/80 p-4 shadow-sm backdrop-blur"
              >
                <div className="flex min-h-6 items-center justify-between gap-x-3 text-xs text-neutral-500">
                  <span
                    title={`@${comment.user.username}`}
                    className="min-w-0 truncate font-semibold text-neutral-900"
                  >
                    @{comment.user.username}
                  </span>
                  {!isConfirming ? (
                    <div className="ml-auto flex shrink-0 items-center gap-3">
                      <time dateTime={comment.createdAt} className="whitespace-nowrap">
                        {formatDateTime(comment.createdAt, locale.locale)}
                      </time>
                      {session.user?.id !== comment.user.id ? (
                        <ReportButton targetType="COMMENT" targetId={comment.id} />
                      ) : null}
                      {canDelete ? (
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
                            setConfirmingId(comment.id);
                          }}
                          className="inline-flex min-h-6 items-center rounded px-1 text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          {tt('card.detail.commentDelete')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 wrap-anywhere">
                  {comment.content}
                </p>
                {isConfirming ? (
                  <div
                    role="group"
                    aria-label={tt('card.detail.confirmDeleteComment')}
                    className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs"
                    onKeyDown={(event) => onConfirmKeyDown(event, comment.id)}
                  >
                    <span className="mr-auto text-red-700">
                      {tt('card.detail.confirmDeleteComment')}
                    </span>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => deleteComment.mutate({ id: comment.id })}
                      className="inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
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
                      className="inline-flex min-h-6 items-center rounded px-1 text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {tt('card.detail.commentDeleteCancel')}
                    </button>
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
