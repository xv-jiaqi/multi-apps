import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow } from '@tarojs/taro';
import { ScrollView, View, Text, Button } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, PrimaryButton, Skeleton } from '@repo/ui-mini';
import { t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { applyTabBarLabels } from '../../../lib/apply-tab-bar-labels';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { useBlock } from '../../../lib/use-block';
import { goToLogin } from '../../../lib/auth-redirect';
import { formatDateTime } from '../../../lib/format-datetime';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import './index.scss';

type TopicListPage = Awaited<ReturnType<typeof trpc.forum.topics.list.query>>;
type TopicListItem = TopicListPage['items'][number];

const PAGE_SIZE = 20;

export default observer(function ForumListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const { state, load } = useBlock<TopicListPage>(() =>
    trpc.forum.topics.list.query({ surface: 'miniapp', limit: PAGE_SIZE }),
  );

  const [extra, setExtra] = useState<TopicListItem[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState<Notice<{ text: string }> | null>(null);

  const resetAndLoad = () => {
    setExtra([]);
    setMoreCursor(null);
    setMoreFailed(null);
    void load();
  };

  useEffect(() => {
    setExtra([]);
    setMoreCursor(null);
    setMoreFailed(null);
    void load();
  }, [load]);

  useDidShow(() => {
    applyTabBarLabels();
    void Taro.setNavigationBarTitle({ title: tt('forum.list.title') });
    if (!state.loading) resetAndLoad();
  });

  const view = resolveBlockView({
    state,
    isEmpty: (data) => data.items.length === 0,
  });

  const firstItems = view.kind === 'success' ? view.data.items : [];
  const items = [...firstItems, ...extra];
  const nextCursor =
    extra.length > 0 ? moreCursor : view.kind === 'success' ? view.data.nextCursor : null;

  const loadMore = async () => {
    if (!nextCursor || moreLoading) return;
    setMoreLoading(true);
    setMoreFailed(null);
    try {
      const page = await trpc.forum.topics.list.query({
        surface: 'miniapp',
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      setExtra((current) => [...current, ...page.items]);
      setMoreCursor(page.nextCursor);
    } catch {
      setMoreFailed({ id: nextNoticeId(), text: tt('forum.list.loadFailed') });
    } finally {
      setMoreLoading(false);
    }
  };

  const onPublish = () => {
    if (!session.isAuthenticated) {
      goToLogin();
      return;
    }
    void Taro.navigateTo({ url: '/pages/forum/new/index' });
  };

  return (
    <ScrollView scrollY className="forum-page">
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
            onRetry={() => void load()}
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

            {nextCursor ? (
              <Button
                className="forum-page__more"
                hoverClass="none"
                disabled={moreLoading ? true : undefined}
                onClick={moreLoading ? undefined : () => void loadMore()}
              >
                {moreLoading ? tt('state.loading') : tt('forum.list.loadMore')}
              </Button>
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
        ) : null}
      </View>
    </ScrollView>
  );
});
