import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { t, type Locale } from '@repo/shared';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';
import { createLoadMoreGuard } from '../../lib/load-more-guard';
import { usePendingSubmit } from '../../lib/use-pending-submit';
import { goLoginIfUnauthorized } from '../../lib/auth-redirect';
import { readTrpcErrorCodes } from '../../lib/load-error';
import { nextNoticeId, type Notice } from '../../lib/notice';
import { ErrorBoxMini } from '../error-box-mini';
import { ReportEntry } from '../report-entry';
import { FocusableButton, focusSelector, focusWhenSettled } from '../focusable-button';
import './index.scss';

export type CardComment = Awaited<ReturnType<typeof trpc.comments.listForCard.query>>[number];
type ReplyPage = Awaited<ReturnType<typeof trpc.comments.listReplies.query>>;
type ReplyItem = ReplyPage['items'][number];

/** Drop common Markdown markers but keep newlines (CH-301 §2). */
export function stripMarkdownKeepNewlines(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

interface ConfirmState {
  id: string;
  kind: 'comment' | 'reply';
  parentId?: string;
  replyCount: number;
}

export interface CardCommentsListProps {
  comments: CardComment[];
  hiddenIds: ReadonlySet<string>;
  onHide: (id: string) => void | Promise<'refreshed' | 'stale'>;
  onNotice: (kind: 'success' | 'error', text: string) => void;
}

export function CardCommentsList({ comments, hiddenIds, onHide, onNotice }: CardCommentsListProps) {
  return (
    <View {...({ 'data-comments-heading': 'true', tabIndex: -1 } as Record<string, unknown>)}>
      {comments
        .filter((comment) => !hiddenIds.has(comment.id))
        .map((comment) => (
          <CommentThread
            key={comment.id}
            comment={comment}
            hiddenIds={hiddenIds}
            onHide={onHide}
            onNotice={onNotice}
          />
        ))}
    </View>
  );
}

function CommentThread({
  comment,
  hiddenIds,
  onHide,
  onNotice,
}: {
  comment: CardComment;
  hiddenIds: ReadonlySet<string>;
  onHide: (id: string) => void | Promise<'refreshed' | 'stale'>;
  onNotice: (kind: 'success' | 'error', text: string) => void;
}) {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [extra, setExtra] = useState<ReplyItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(comment.repliesNextCursor ?? null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState<Notice<{ text: string }> | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; text: string } | null>(null);
  const guard = useRef(createLoadMoreGuard());
  const deleting = usePendingSubmit();

  const previewKey = `${comment.replyCount}|${comment.repliesNextCursor ?? ''}|${comment.replies
    .map((reply) => reply.id)
    .join(',')}`;
  useEffect(() => {
    setExtra([]);
    setCursor(comment.repliesNextCursor ?? null);
    setMoreFailed(null);
    setMoreLoading(false);
    guard.current.invalidate();
  }, [previewKey, comment.repliesNextCursor]);

  const preview = comment.replies.filter((reply) => !hiddenIds.has(reply.id));
  const loaded = extra.filter((reply) => !hiddenIds.has(reply.id));
  const replies = [...preview, ...loaded];
  const remaining = Math.max(0, comment.replyCount - comment.replies.length - extra.length);

  const canDeleteComment = session.user?.id === comment.user.id || session.isAdmin;
  const showReportComment = session.user?.id !== comment.user.id;

  const loadMore = async () => {
    const next = cursor ?? comment.repliesNextCursor;
    if (!next) return;
    const token = guard.current.tryStart();
    if (token === null) return;
    setMoreLoading(true);
    setMoreFailed(null);
    try {
      const page = await trpc.comments.listReplies.query({
        parentId: comment.id,
        cursor: next,
        limit: 20,
        surface: 'miniapp',
      });
      if (!guard.current.isCurrent(token)) return;
      setExtra((current: ReplyItem[]) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      if (!guard.current.isCurrent(token)) return;
      setMoreFailed({ id: nextNoticeId(), text: tt('comment.reply.loadFailed') });
    } finally {
      guard.current.finish(token);
      if (guard.current.isCurrent(token)) setMoreLoading(false);
    }
  };

  const confirmDelete = (state: ConfirmState) => {
    setDeleteError(null);
    setConfirm(state);
  };

  const cancelConfirm = () => {
    const id = confirm?.id;
    setConfirm(null);
    if (id) focusSelector(`[data-delete-trigger="${id}"]`);
  };

  useLayoutEffect(() => {
    if (!confirm || typeof document === 'undefined') return;
    const stop = focusWhenSettled(() =>
      document.querySelector<HTMLElement>(`.card-comment__confirm [data-confirm-action="delete"]`),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || deleting.pending) return;
      event.preventDefault();
      cancelConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      stop();
      document.removeEventListener('keydown', onKey);
    };
  }, [confirm, deleting.pending]);

  const runDelete = async () => {
    if (!confirm || !deleting.begin()) return;
    const successText =
      confirm.kind === 'reply'
        ? tt('comment.reply.deleted')
        : confirm.replyCount > 0
          ? tt('comment.deletedWithReplies', { count: confirm.replyCount })
          : tt('card.detail.commentDeleted');
    const finishHide = async () => {
      const hiddenId = confirm.id;
      const result = await onHide(hiddenId);
      if (result !== 'stale') onNotice('success', successText);
      setConfirm(null);
      const next = () => {
        const row = document.querySelector<HTMLElement>(
          `.card-comment [data-delete-trigger]:not([data-delete-trigger="${hiddenId}"]), .card-comment [data-report-trigger]`,
        );
        if (row) return row;
        return document.querySelector<HTMLElement>('[data-comments-heading]');
      };
      focusWhenSettled(next);
    };
    try {
      await trpc.comments.delete.mutate({ id: confirm.id });
      await finishHide();
    } catch (error) {
      if (goLoginIfUnauthorized(error)) {
        setConfirm(null);
        return;
      }
      const { code, appCode } = readTrpcErrorCodes(error);
      if (code === 'NOT_FOUND' || appCode === 'NOT_FOUND') {
        await finishHide();
        return;
      }
      const forbidden = code === 'FORBIDDEN' || appCode === 'FORBIDDEN' || appCode === 'FORBIDDEN';
      const failedId = confirm.id;
      setConfirm(null);
      setDeleteError({
        id: failedId,
        text: forbidden
          ? tt('card.detail.commentDeleteForbidden')
          : tt('card.detail.commentDeleteFailed'),
      });
      focusSelector(`[data-delete-trigger="${failedId}"]`);
    } finally {
      deleting.end();
    }
  };

  return (
    <View className="card-comment comment-item">
      <View className="card-comment__meta">
        <Text className="card-comment__author">@{comment.user.username}</Text>
        <Text className="card-comment__time">
          {new Date(comment.createdAt).toLocaleString(locale.locale)}
        </Text>
        {comment.safetyStatus === 'review' ? (
          <Text className="card-comment__review">{tt('content.pendingReview')}</Text>
        ) : null}
      </View>
      <Text className="card-comment__body comment-item__content">
        {stripMarkdownKeepNewlines(comment.content)}
      </Text>
      <View className="card-comment__actions">
        {showReportComment ? (
          <ReportEntry
            targetType="COMMENT"
            targetId={comment.id}
            onSuccess={() => onNotice('success', tt('report.success'))}
          />
        ) : null}
        {canDeleteComment ? (
          <FocusableButton
            className="card-comment__action"
            aria-label={tt('card.detail.commentDeleteAria', { user: comment.user.username })}
            data-delete-trigger={comment.id}
            data-toast-avoid="true"
            onClick={() =>
              confirmDelete({
                id: comment.id,
                kind: 'comment',
                replyCount: comment.replyCount,
              })
            }
          >
            {tt('card.detail.commentDelete')}
          </FocusableButton>
        ) : null}
      </View>
      {confirm && confirm.id === comment.id && confirm.kind === 'comment' ? (
        <ConfirmBar
          locale={locale.locale}
          pending={deleting.pending}
          message={
            confirm.replyCount > 0
              ? tt('comment.confirmDeleteWithReplies', { count: confirm.replyCount })
              : tt('card.detail.confirmDeleteComment')
          }
          onConfirm={() => void runDelete()}
          onCancel={deleting.pending ? undefined : cancelConfirm}
        />
      ) : null}
      {deleteError && deleteError.id === comment.id ? (
        <View className="card-comment__error" ariaRole="alert">
          <Text className="card-comment__error-text">{deleteError.text}</Text>
        </View>
      ) : null}

      {replies.length > 0 ? (
        <View className="card-comment__replies">
          {replies.map((reply) => {
            const canDeleteReply = session.user?.id === reply.user.id || session.isAdmin;
            const showReportReply = session.user?.id !== reply.user.id;
            const safety =
              'safetyStatus' in reply
                ? (reply as { safetyStatus?: string }).safetyStatus
                : undefined;
            return (
              <View key={reply.id} className="card-comment card-comment--reply">
                <View className="card-comment__meta">
                  <Text className="card-comment__author">@{reply.user.username}</Text>
                  <Text className="card-comment__time">
                    {new Date(reply.createdAt).toLocaleString(locale.locale)}
                  </Text>
                  {safety === 'review' ? (
                    <Text className="card-comment__review">{tt('content.pendingReview')}</Text>
                  ) : null}
                </View>
                <Text className="card-comment__body">
                  {stripMarkdownKeepNewlines(reply.content)}
                </Text>
                <View className="card-comment__actions">
                  {showReportReply ? (
                    <ReportEntry
                      targetType="COMMENT"
                      targetId={reply.id}
                      onSuccess={() => onNotice('success', tt('report.success'))}
                    />
                  ) : null}
                  {canDeleteReply ? (
                    <FocusableButton
                      className="card-comment__action"
                      aria-label={tt('card.detail.commentDeleteAria', {
                        user: reply.user.username,
                      })}
                      data-delete-trigger={reply.id}
                      data-toast-avoid="true"
                      onClick={() =>
                        confirmDelete({
                          id: reply.id,
                          kind: 'reply',
                          parentId: comment.id,
                          replyCount: 0,
                        })
                      }
                    >
                      {tt('card.detail.commentDelete')}
                    </FocusableButton>
                  ) : null}
                </View>
                {confirm && confirm.id === reply.id && confirm.kind === 'reply' ? (
                  <ConfirmBar
                    locale={locale.locale}
                    pending={deleting.pending}
                    message={tt('comment.reply.confirmDelete')}
                    onConfirm={() => void runDelete()}
                    onCancel={deleting.pending ? undefined : cancelConfirm}
                  />
                ) : null}
                {deleteError && deleteError.id === reply.id ? (
                  <View className="card-comment__error" ariaRole="alert">
                    <Text className="card-comment__error-text">{deleteError.text}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {cursor ? (
        <FocusableButton
          className={`card-comment__more${moreLoading ? ' card-comment__more--disabled' : ''}`}
          aria-disabled={moreLoading}
          onClick={() => void loadMore()}
        >
          {moreLoading ? tt('state.loading') : tt('comment.reply.showMore', { count: remaining })}
        </FocusableButton>
      ) : null}
      {moreFailed ? (
        <ErrorBoxMini
          key={moreFailed.id}
          title={moreFailed.text}
          retryLabel={tt('state.retry')}
          retryingLabel={tt('state.retrying')}
          retrying={moreLoading}
          onRetry={() => void loadMore()}
        />
      ) : null}
    </View>
  );
}

function ConfirmBar({
  locale,
  message,
  pending,
  onConfirm,
  onCancel,
}: {
  locale: Locale;
  message: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: (() => void) | undefined;
}) {
  const tt = (key: string) => t(locale, key);
  return (
    <View className="card-comment__confirm" ariaRole="alert">
      <Text className="card-comment__confirm-text">{message}</Text>
      <View className="card-comment__confirm-actions">
        <FocusableButton
          className={`card-comment__action${pending ? ' card-comment__action--disabled' : ''}`}
          aria-label={pending ? tt('card.detail.commentDeleting') : tt('card.detail.commentDelete')}
          aria-disabled={pending}
          data-confirm-action="delete"
          onClick={onConfirm}
        >
          {pending ? tt('card.detail.commentDeleting') : tt('card.detail.commentDelete')}
        </FocusableButton>
        <FocusableButton
          className={`card-comment__action${pending ? ' card-comment__action--disabled' : ''}`}
          aria-label={tt('card.detail.commentDeleteCancel')}
          aria-disabled={pending || !onCancel}
          data-confirm-action="cancel"
          onClick={onCancel}
        >
          {tt('card.detail.commentDeleteCancel')}
        </FocusableButton>
      </View>
    </View>
  );
}

export function NoticeBanner({
  id,
  kind,
  text,
}: {
  id: number;
  kind: 'success' | 'error';
  text: string;
}) {
  return (
    <View
      key={id}
      className={`notice-banner notice-banner--${kind}`}
      ariaRole={kind === 'error' ? 'alert' : 'status'}
    >
      <Text className="notice-banner__text">{text}</Text>
    </View>
  );
}
