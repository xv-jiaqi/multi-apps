import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { ScrollView, View, Text } from '@tarojs/components';
import {
  BreadcrumbsMini,
  Empty,
  FocusableButton,
  Link,
  PrimaryButton,
  Skeleton,
} from '@repo/ui-mini';
import { t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { applyTabBarLabels } from '../../../lib/apply-tab-bar-labels';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { useBlock } from '../../../lib/use-block';
import { useLoadMore } from '../../../lib/use-load-more';
import { goToLogin } from '../../../lib/auth-redirect';
import { formatDateTime } from '../../../lib/format-datetime';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import { StatusToast } from '../../../components/status-toast';
import { consumeListNeedsRefresh } from '../../../lib/list-refresh';
import { useScrollRestore } from '../../../lib/scroll-restore';
import {
  forgetListSession,
  listAuthKey,
  readListSession,
  rememberListSession,
} from '../../../lib/list-session';
import { useStatusToast } from '../../../lib/status-toast';
import './index.scss';

type TopicListPage = Awaited<ReturnType<typeof trpc.forum.topics.list.query>>;
type TopicListItem = TopicListPage['items'][number];

const PAGE_SIZE = 20;

export default observer(function ForumListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const authKey = listAuthKey(session);
  const cached = readListSession<TopicListPage, TopicListItem>('forum', authKey);

  const { state, load } = useBlock<TopicListPage>(
    () => trpc.forum.topics.list.query({ surface: 'miniapp', limit: PAGE_SIZE }),
    cached?.data,
  );
  const more = useLoadMore<TopicListItem>(cached ?? undefined);
  const toast = useStatusToast();
  const scroll = useScrollRestore('.forum-page', 'forum');
  const firstShow = useRef(true);
  const lastAuth = useRef(authKey);
  const dataRef = useRef(state.data);
  dataRef.current = state.data;

  const resetAndLoad = (keepDataOnError = false) => {
    // Page 1 reload: after the author just submitted, when auth changes,
    // or on pull-down refresh (CH-301 §2.8 v1.5). Other returns keep
    // already-loaded items and scroll position.
    more.reset();
    scroll.reset();
    forgetListSession('forum');
    return load({ fresh: true, keepDataOnError }).catch(() => {
      toast.show(tt('forum.list.loadFailed'));
    });
  };

  useDidShow(() => {
    applyTabBarLabels();
    void Taro.setNavigationBarTitle({ title: tt('forum.list.title') });
    toast.consumeQueued();
    const authChanged = lastAuth.current !== authKey;
    lastAuth.current = authKey;
    const afterSubmit = consumeListNeedsRefresh('forum');
    if (firstShow.current) {
      firstShow.current = false;
      if (cached) {
        scroll.restore();
      } else {
        void resetAndLoad();
      }
      return;
    }
    if (afterSubmit || authChanged) {
      void resetAndLoad(Boolean(dataRef.current));
    } else {
      scroll.restore();
    }
  });

  useEffect(() => {
    if (!state.data || state.loading) return;
    rememberListSession('forum', {
      data: state.data,
      extra: more.extra,
      moreCursor: more.moreCursor,
      scrollTop: scroll.scrollTop,
      auth: authKey,
    });
  }, [state.data, state.loading, more.extra, more.moreCursor, scroll.scrollTop, authKey]);

  usePullDownRefresh(() => {
    void Promise.resolve(resetAndLoad()).finally(() => {
      void Taro.stopPullDownRefresh();
    });
  });

  const view = resolveBlockView({
    state,
    isEmpty: (data) => data.items.length === 0,
  });

  const firstItems = view.kind === 'success' ? view.data.items : [];
  const items = [...firstItems, ...more.extra];
  const nextCursor = state.loading
    ? null
    : more.extra.length > 0
      ? more.moreCursor
      : view.kind === 'success'
        ? view.data.nextCursor
        : null;

  const loadingMore = more.moreLoading || state.loading;
  const onLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    void more.loadMore({
      cursor: nextCursor,
      failedText: tt('forum.list.loadFailed'),
      fetchPage: (cursor) =>
        trpc.forum.topics.list.query({ surface: 'miniapp', limit: PAGE_SIZE, cursor }),
    });
  };

  const onPublish = () => {
    if (!session.isAuthenticated) {
      goToLogin();
      return;
    }
    void Taro.navigateTo({ url: '/pages/forum/new/index' });
  };

  return (
    <ScrollView
      scrollY
      scrollTop={scroll.scrollTop}
      onScroll={scroll.onScroll}
      className="forum-page"
    >
      <View className="forum-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('forum.list.title') },
          ]}
        />

        <View className="forum-page__header">
          <Text className="forum-page__title">{tt('forum.list.title')}</Text>
          <PrimaryButton label={tt('forum.list.newTopic')} onClick={onPublish} />
        </View>

        {view.kind === 'loading' ? <Skeleton /> : null}

        {view.kind === 'failed' ? (
          <ErrorBoxMini
            key={view.noticeId}
            title={tt('forum.list.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={view.retrying}
            onRetry={() => void load({ fresh: true })}
          />
        ) : null}

        {view.kind === 'notFound' ? <Empty title={tt('state.notFound')} /> : null}

        {view.kind === 'empty' ? <Empty title={tt('forum.list.empty')} /> : null}

        {view.kind === 'success' ? (
          <View>
            {items.map((topic) => (
              <Link
                key={topic.id}
                to={`/pages/forum/detail/index?slug=${encodeURIComponent(topic.slug)}`}
                className="forum-card"
              >
                <View className="forum-card__text">
                  <Text className="forum-card__title">{topic.title}</Text>
                  {topic.safetyStatus === 'review' ? (
                    <Text className="forum-review-tag">{tt('content.pendingReview')}</Text>
                  ) : null}
                  {topic.excerpt ? (
                    <Text className="forum-card__excerpt">{topic.excerpt}</Text>
                  ) : null}
                  <Text className="forum-card__meta">
                    {topic.author.username} · {formatDateTime(topic.createdAt, locale.locale)} ·{' '}
                    {tt('forum.list.replyCount', { count: topic.replyCount })}
                  </Text>
                </View>
              </Link>
            ))}

            {nextCursor && !more.moreFailed ? (
              <FocusableButton
                className={
                  loadingMore ? 'forum-page__more forum-page__more--disabled' : 'forum-page__more'
                }
                hoverClass="none"
                disabled={loadingMore ? true : undefined}
                onClick={loadingMore ? undefined : () => onLoadMore()}
              >
                {more.moreLoading ? tt('state.loading') : tt('forum.list.loadMore')}
              </FocusableButton>
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
          </View>
        ) : null}
        <StatusToast notice={toast.notice} />
      </View>
    </ScrollView>
  );
});
