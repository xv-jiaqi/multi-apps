import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow } from '@tarojs/taro';
import { Button, ScrollView, Text, View } from '@tarojs/components';
import { BreadcrumbsMini, Empty, PrimaryButton, Skeleton } from '@repo/ui-mini';
import { t, type ListingKind } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { applyTabBarLabels } from '../../../lib/apply-tab-bar-labels';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { useBlock } from '../../../lib/use-block';
import { goToLogin } from '../../../lib/auth-redirect';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import { ListingRow, type ListingItem } from '../../../components/listing-row';
import './index.scss';

type ListingListPage = Awaited<ReturnType<typeof trpc.listings.list.query>>;

const PAGE_SIZE = 20;

export default observer(function TradeListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [kind, setKind] = useState<ListingKind | undefined>(undefined);

  const { state, load } = useBlock<ListingListPage>(() =>
    trpc.listings.list.query({ surface: 'miniapp', limit: PAGE_SIZE, kind }),
  );

  const [extra, setExtra] = useState<ListingItem[]>([]);
  const [moreCursor, setMoreCursor] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState<Notice<{ text: string }> | null>(null);

  useEffect(() => {
    setExtra([]);
    setMoreCursor(null);
    setMoreFailed(null);
    void load();
  }, [load, kind]);

  useDidShow(() => {
    applyTabBarLabels();
    void Taro.setNavigationBarTitle({ title: tt('trade.list.title') });
    if (!state.loading) {
      setExtra([]);
      setMoreCursor(null);
      setMoreFailed(null);
      void load();
    }
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
      const page = await trpc.listings.list.query({
        surface: 'miniapp',
        limit: PAGE_SIZE,
        kind,
        cursor: nextCursor,
      });
      setExtra((current) => [...current, ...page.items]);
      setMoreCursor(page.nextCursor);
    } catch {
      setMoreFailed({ id: nextNoticeId(), text: tt('trade.list.loadFailed') });
    } finally {
      setMoreLoading(false);
    }
  };

  const onPublish = () => {
    if (!session.isAuthenticated) {
      goToLogin();
      return;
    }
    void Taro.navigateTo({ url: '/pages/trade/publish/index' });
  };

  const filters: Array<{ id: 'all' | ListingKind; label: string; value: ListingKind | undefined }> =
    [
      { id: 'all', label: tt('trade.list.filterAll'), value: undefined },
      { id: 'SELL', label: tt('trade.list.kindSell'), value: 'SELL' },
      { id: 'BUY', label: tt('trade.list.kindBuy'), value: 'BUY' },
    ];

  return (
    <ScrollView scrollY className="trade-page">
      <View className="trade-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('trade.list.title') },
          ]}
        />

        <View className="trade-page__header">
          <Text className="trade-page__title">{tt('trade.list.title')}</Text>
          <View className="trade-page__disclaimer">
            <Text className="trade-page__disclaimer-text">{tt('trade.list.disclaimer')}</Text>
          </View>
          <PrimaryButton label={tt('trade.list.publish')} onClick={onPublish} />
        </View>

        <View className="trade-filters">
          {filters.map((filter) => {
            const active = kind === filter.value;
            return (
              <Button
                key={filter.id}
                className={`trade-filters__chip${active ? ' trade-filters__chip--active' : ''}`}
                hoverClass="none"
                onClick={() => setKind(filter.value)}
              >
                {filter.label}
              </Button>
            );
          })}
        </View>

        {view.kind === 'loading' ? <Skeleton /> : null}

        {view.kind === 'failed' ? (
          <ErrorBoxMini
            key={view.noticeId}
            title={tt('trade.list.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={view.retrying}
            onRetry={() => void load()}
          />
        ) : null}

        {view.kind === 'notFound' ? <Empty title={tt('state.notFound')} /> : null}
        {view.kind === 'empty' ? <Empty title={tt('trade.list.empty')} /> : null}

        {view.kind === 'success' ? (
          <View>
            {items.map((listing) => (
              <ListingRow key={listing.id} listing={listing} locale={locale.locale} />
            ))}
            {nextCursor ? (
              <Button
                className="trade-page__more"
                hoverClass="none"
                disabled={moreLoading ? true : undefined}
                onClick={moreLoading ? undefined : () => void loadMore()}
              >
                {moreLoading ? tt('state.loading') : tt('trade.list.loadMore')}
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
