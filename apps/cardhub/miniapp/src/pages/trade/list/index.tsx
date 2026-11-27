import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { ScrollView, Text, View } from '@tarojs/components';
import { BreadcrumbsMini, Empty, FocusableButton, PrimaryButton, Skeleton } from '@repo/ui-mini';
import { t, type ListingKind } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { applyTabBarLabels } from '../../../lib/apply-tab-bar-labels';
import { useStores } from '../../../stores/root-store';
import { resolveBlockView } from '../../../lib/block-view';
import { useBlock } from '../../../lib/use-block';
import { goToLogin } from '../../../lib/auth-redirect';
import { createLoadMoreGuard } from '../../../lib/load-more-guard';
import { consumeListNeedsRefresh } from '../../../lib/list-refresh';
import { useScrollRestore } from '../../../lib/scroll-restore';
import {
  forgetListSession,
  listAuthKey,
  readListSession,
  rememberListSession,
  writeListScroll,
  type ListSessionKey,
} from '../../../lib/list-session';
import { useStatusToast } from '../../../lib/status-toast';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import { StatusToast } from '../../../components/status-toast';
import { ListingRow, type ListingItem } from '../../../components/listing-row';
import './index.scss';

type ListingListPage = Awaited<ReturnType<typeof trpc.listings.list.query>> & {
  filterKind: ListingKind | undefined;
};

const PAGE_SIZE = 20;

function tradeSessionKey(kind: ListingKind | undefined): ListSessionKey {
  return `trade:${kind ?? 'all'}`;
}

export default observer(function TradeListPage() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [kind, setKind] = useState<ListingKind | undefined>(undefined);
  const sessionKey = tradeSessionKey(kind);
  const authKey = listAuthKey(session);
  const cached = readListSession<ListingListPage, ListingItem>(sessionKey, authKey);
  const toast = useStatusToast();
  const scroll = useScrollRestore('.trade-list-page', sessionKey);
  const firstShow = useRef(true);
  const lastAuth = useRef(authKey);
  const skipKindEffect = useRef(Boolean(cached));

  const { state, load } = useBlock<ListingListPage>(async () => {
    const requested = kind;
    const page = await trpc.listings.list.query({
      surface: 'miniapp',
      limit: PAGE_SIZE,
      kind: requested,
    });
    return { ...page, filterKind: requested };
  }, cached?.data);
  const dataRef = useRef(state.data);
  dataRef.current = state.data;

  const [extra, setExtra] = useState<ListingItem[]>(() => cached?.extra ?? []);
  const [moreCursor, setMoreCursor] = useState<string | null>(() => cached?.moreCursor ?? null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState<Notice<{ text: string }> | null>(null);
  const moreGuard = useRef(createLoadMoreGuard());

  const resetPaging = () => {
    scroll.reset();
    moreGuard.current.invalidate();
    setExtra([]);
    setMoreCursor(null);
    setMoreFailed(null);
    setMoreLoading(false);
  };

  const resetAndLoad = (keepDataOnError = false) => {
    resetPaging();
    forgetListSession(sessionKey);
    return load({ fresh: true, keepDataOnError }).catch(() => {
      toast.show(tt('trade.list.loadFailed'));
    });
  };

  useEffect(() => {
    if (skipKindEffect.current) {
      skipKindEffect.current = false;
      return;
    }
    resetPaging();
    forgetListSession(sessionKey);
    void load({ fresh: true });
  }, [load, kind]);

  useDidShow(() => {
    applyTabBarLabels();
    void Taro.setNavigationBarTitle({ title: tt('trade.list.title') });
    toast.consumeQueued();
    const authChanged = lastAuth.current !== authKey;
    lastAuth.current = authKey;
    const afterSubmit = consumeListNeedsRefresh('trade');
    if (firstShow.current) {
      firstShow.current = false;
      if (afterSubmit || authChanged) {
        void resetAndLoad(Boolean(dataRef.current));
        return;
      }
      if (cached) scroll.restore();
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
    rememberListSession(sessionKey, {
      data: state.data,
      extra,
      moreCursor,
      scrollTop: scroll.scrollTop,
      auth: authKey,
    });
  }, [sessionKey, state.data, state.loading, extra, moreCursor, scroll.scrollTop, authKey]);

  usePullDownRefresh(() => {
    void Promise.resolve(resetAndLoad()).finally(() => {
      void Taro.stopPullDownRefresh();
    });
  });

  const staleFilter = Boolean(state.data && state.data.filterKind !== kind);
  const view = resolveBlockView({
    state,
    isEmpty: (data) => data.items.length === 0,
  });
  const showItems = view.kind === 'success' && !staleFilter;
  const firstItems = showItems && view.kind === 'success' ? view.data.items : [];
  const items = [...firstItems, ...extra];
  const nextCursor =
    state.loading || staleFilter
      ? null
      : extra.length > 0
        ? moreCursor
        : showItems && view.kind === 'success'
          ? view.data.nextCursor
          : null;

  const loadMore = async () => {
    if (!nextCursor || state.loading) return;
    const token = moreGuard.current.tryStart();
    if (token === null) return;
    setMoreLoading(true);
    setMoreFailed(null);
    try {
      const page = await trpc.listings.list.query({
        surface: 'miniapp',
        limit: PAGE_SIZE,
        kind,
        cursor: nextCursor,
      });
      if (!moreGuard.current.isCurrent(token)) return;
      setExtra((current) => [...current, ...page.items]);
      setMoreCursor(page.nextCursor);
    } catch {
      if (!moreGuard.current.isCurrent(token)) return;
      setMoreFailed({ id: nextNoticeId(), text: tt('trade.list.loadFailed') });
    } finally {
      moreGuard.current.finish(token);
      if (moreGuard.current.isCurrent(token)) setMoreLoading(false);
    }
  };

  const onPublish = () => {
    if (typeof document !== 'undefined') {
      const el = document.querySelector('.trade-list-page') as HTMLElement | null;
      if (el) writeListScroll(sessionKey, el.scrollTop);
    }
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

  const showLoading = view.kind === 'loading' || (state.loading && staleFilter);

  return (
    <ScrollView
      scrollY
      scrollTop={scroll.scrollTop}
      onScroll={scroll.onScroll}
      className="trade-page trade-list-page"
    >
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
              <FocusableButton
                key={filter.id}
                className={`trade-filters__chip${active ? ' trade-filters__chip--active' : ''}`}
                hoverClass="none"
                onClick={() => setKind(filter.value)}
                ariaPressed={active}
                aria-pressed={active}
              >
                {filter.label}
              </FocusableButton>
            );
          })}
        </View>

        {showLoading ? <Skeleton /> : null}

        {view.kind === 'failed' && !state.data ? (
          <ErrorBoxMini
            key={view.noticeId}
            title={tt('trade.list.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={view.retrying}
            onRetry={() => void load({ fresh: true })}
          />
        ) : null}

        {view.kind === 'notFound' ? <Empty title={tt('state.notFound')} /> : null}
        {!staleFilter && view.kind === 'empty' ? <Empty title={tt('trade.list.empty')} /> : null}

        {!staleFilter && view.kind === 'success' ? (
          <View>
            {items.map((listing) => (
              <ListingRow key={listing.id} listing={listing} locale={locale.locale} />
            ))}
            {nextCursor && !moreFailed ? (
              <FocusableButton
                className={`trade-page__more${moreLoading || state.loading ? ' trade-page__more--disabled' : ''}`}
                hoverClass="none"
                disabled={moreLoading || state.loading ? true : undefined}
                onClick={moreLoading || state.loading ? undefined : () => void loadMore()}
              >
                {moreLoading ? tt('state.loading') : tt('trade.list.loadMore')}
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
        ) : null}
        <StatusToast notice={toast.notice} />
      </View>
    </ScrollView>
  );
});
