import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { ScrollView, View, Text, Textarea } from '@tarojs/components';
import {
  BreadcrumbsMini,
  Empty,
  FocusableButton,
  Link,
  PrimaryButton,
  Skeleton,
} from '@repo/ui-mini';
import { APP_ERROR_CODES, fieldErrorMessage, replyCreateInput, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { LocalNotFoundError, mutationErrorMessage } from '../../../lib/load-error';
import { useBlock } from '../../../lib/use-block';
import { useLoadMore } from '../../../lib/use-load-more';
import { goLoginIfUnauthorized, goToLogin, LOGIN_PAGE } from '../../../lib/auth-redirect';
import { formatDateTime } from '../../../lib/format-datetime';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { stripMarkdownKeepNewlines } from '../../../lib/plain-text';
import { usePendingSubmit } from '../../../lib/use-pending-submit';
import { isPublicSafetyStatus, SUBMITTED_FOR_REVIEW_KEY } from '../../../lib/post-safety';
import { useStatusToast } from '../../../lib/status-toast';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import { StatusToast } from '../../../components/status-toast';
import './index.scss';

type TopicDetail = Awaited<ReturnType<typeof trpc.forum.topics.bySlug.query>>;
type ReplyItem = TopicDetail['replies'][number];

const PAGE_SIZE = 20;

export default observer(function ForumDetailPage() {
  const router = useRouter();
  const slug = (router.params.slug ?? '').toString();
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const { state, load } = useBlock<TopicDetail>(async () => {
    if (!slug) throw new LocalNotFoundError('missing slug');
    const topic = await trpc.forum.topics.bySlug.query({ slug, surface: 'miniapp' });
    const navTitle =
      topic.safetyStatus === 'blocked' || !topic.title ? tt('forum.list.title') : topic.title;
    void Taro.setNavigationBarTitle({ title: navTitle });
    return topic;
  });
  const more = useLoadMore<ReplyItem>();

  const [replyBody, setReplyBody] = useState('');
  const [replyError, setReplyError] = useState<Notice<{ text: string }> | null>(null);
  const toast = useStatusToast();
  const submit = usePendingSubmit();

  useEffect(() => {
    more.reset();
    setReplyBody('');
    setReplyError(null);
    void load({ fresh: true });
  }, [slug, load, more.reset]);

  useDidShow(() => {
    const topic = state.data;
    if (!topic) return;
    const navTitle =
      topic.safetyStatus === 'blocked' || !topic.title ? tt('forum.list.title') : topic.title;
    void Taro.setNavigationBarTitle({ title: navTitle });
  });

  const view = resolveBlockView({ state, isEmpty: () => false });
  const topic = view.kind === 'success' ? view.data : null;
  const blocked = topic?.safetyStatus === 'blocked';
  const firstReplies = topic && !blocked ? topic.replies : [];
  const replies = [...firstReplies, ...more.extra];
  const nextCursor =
    more.extra.length > 0 ? more.moreCursor : topic && !blocked ? topic.replyNextCursor : null;

  const loadingMore = more.moreLoading || state.loading;
  const onLoadMore = () => {
    if (!topic || !nextCursor || loadingMore || blocked) return;
    void more.loadMore({
      cursor: nextCursor,
      failedText: tt('forum.detail.loadMoreFailed'),
      fetchPage: (cursor) =>
        trpc.forum.replies.list.query({
          topicId: topic.id,
          cursor,
          limit: PAGE_SIZE,
          surface: 'miniapp',
        }),
    });
  };

  const showReplyError = (text: string) => setReplyError({ id: nextNoticeId(), text });

  const submitReply = async () => {
    if (submit.pending || blocked || !topic) return;
    setReplyError(null);
    const parsed = replyCreateInput.safeParse({ topicId: topic.id, body: replyBody });
    if (!parsed.success) {
      showReplyError(fieldErrorMessage(locale.locale, parsed.error.issues[0]?.message));
      return;
    }
    if (!session.isAuthenticated) {
      goToLogin();
      return;
    }
    if (!submit.begin()) return;
    try {
      const created = await trpc.forum.replies.create.mutate(parsed.data);
      setReplyBody('');
      if (!isPublicSafetyStatus(created.safetyStatus)) {
        toast.show(tt(SUBMITTED_FOR_REVIEW_KEY));
        return;
      }
      try {
        await load({ fresh: true, keepDataOnError: true });
        more.reset();
      } catch {
        toast.show(tt('forum.reply.postedRefreshFailed'));
      }
    } catch (error) {
      if (goLoginIfUnauthorized(error)) return;
      showReplyError(
        mutationErrorMessage({
          locale: locale.locale,
          error,
          copy: { [APP_ERROR_CODES.CONTENT_BLOCKED]: tt('content.blocked') },
        }),
      );
    } finally {
      submit.end();
    }
  };

  const showTopicCrumb = view.kind === 'success' && topic && !blocked && Boolean(topic.title);
  const crumbs = [
    { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' as const },
    { label: tt('forum.list.title'), to: '/pages/forum/list/index', mode: 'switchTab' as const },
    ...(showTopicCrumb ? [{ label: topic.title }] : []),
  ];

  return (
    <ScrollView scrollY className="forum-page">
      <View className="forum-page__body">
        <BreadcrumbsMini items={crumbs} />

        {view.kind === 'loading' ? <Skeleton /> : null}

        {view.kind === 'failed' ? (
          <ErrorBoxMini
            key={view.noticeId}
            title={tt('forum.detail.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={view.retrying}
            onRetry={() => void load({ fresh: true })}
          />
        ) : null}

        {view.kind === 'notFound' ? <Empty title={tt('state.notFound')} /> : null}

        {topic && blocked ? (
          <View className="forum-blocked" ariaRole="alert">
            <Text className="forum-blocked__text">{tt('content.blocked')}</Text>
          </View>
        ) : null}

        {topic && !blocked ? (
          <View>
            <Text className="forum-topic-title">{topic.title}</Text>
            {topic.safetyStatus === 'review' ? (
              <Text className="forum-review-tag">{tt('content.pendingReview')}</Text>
            ) : null}
            <Text className="forum-topic-meta">
              {topic.author.username} · {formatDateTime(topic.createdAt, locale.locale)}
            </Text>
            <Text className="forum-body">{stripMarkdownKeepNewlines(topic.body)}</Text>

            <Text className="forum-section-title">
              {tt('forum.detail.repliesTitle', { count: topic.replyCount })}
            </Text>

            {replies.length === 0 ? <Empty title={tt('forum.detail.noReplies')} /> : null}

            {replies.map((reply) => (
              <View key={reply.id} className="forum-reply">
                <Text className="forum-reply__meta">
                  {reply.author.username} · {formatDateTime(reply.createdAt, locale.locale)}
                  {reply.safetyStatus === 'review' ? (
                    <Text className="forum-review-tag">{tt('content.pendingReview')}</Text>
                  ) : null}
                </Text>
                <Text className="forum-body">{stripMarkdownKeepNewlines(reply.body)}</Text>
              </View>
            ))}

            {nextCursor ? (
              <FocusableButton
                className={
                  loadingMore ? 'forum-page__more forum-page__more--disabled' : 'forum-page__more'
                }
                hoverClass="none"
                disabled={loadingMore ? true : undefined}
                onClick={loadingMore ? undefined : () => onLoadMore()}
              >
                {more.moreLoading ? tt('state.loading') : tt('forum.detail.loadMoreReplies')}
              </FocusableButton>
            ) : replies.length > 0 ? (
              <Text className="forum-card__meta">{tt('forum.detail.allRepliesShown')}</Text>
            ) : null}

            {more.moreFailed ? (
              <ErrorBoxMini
                key={more.moreFailed.id}
                title={more.moreFailed.text}
                retryLabel={tt('state.retry')}
                retryingLabel={tt('state.retrying')}
                retrying={more.moreLoading}
                onRetry={() => onLoadMore()}
              />
            ) : null}

            {session.isAuthenticated ? (
              <View className="forum-page__header">
                <Text id="forum-detail-reply-label" className="forum-section-title">
                  {tt('forum.detail.replyLabel')}
                </Text>
                <Textarea
                  className="forum-form__input"
                  value={replyBody}
                  placeholder={tt('forum.detail.replyPlaceholder')}
                  maxlength={5000}
                  disabled={submit.pending ? true : undefined}
                  ariaLabel={tt('forum.detail.replyLabel')}
                  nativeProps={{ 'aria-labelledby': 'forum-detail-reply-label' }}
                  onInput={(event) => setReplyBody(event.detail.value)}
                />
                {replyError ? (
                  <View key={replyError.id} className="forum-form__error" ariaRole="alert">
                    <Text className="forum-form__error-text">{replyError.text}</Text>
                  </View>
                ) : null}
                <View className="forum-form__footer">
                  <Text className="forum-form__count">{replyBody.length} / 5000</Text>
                  <PrimaryButton
                    label={
                      submit.pending
                        ? tt('forum.detail.replySubmitting')
                        : tt('forum.detail.replySubmit')
                    }
                    disabled={submit.pending}
                    onClick={() => void submitReply()}
                  />
                </View>
              </View>
            ) : (
              <Link to={LOGIN_PAGE} className="forum-login">
                <Text className="forum-login__text">{tt('forum.detail.loginToReply')}</Text>
              </Link>
            )}
          </View>
        ) : null}

        <StatusToast notice={toast.notice} />
      </View>
    </ScrollView>
  );
});
