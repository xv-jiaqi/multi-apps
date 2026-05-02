import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, PrimaryButton, SectionCard, Skeleton } from '@repo/ui-mini';
import { APP_NAME, t } from '@repo/shared';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';
import { gradientFor } from '../../lib/gradients';

type SeriesListResult = Awaited<ReturnType<typeof trpc.series.list.query>>;

export default observer(function Index() {
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [data, setData] = useState<SeriesListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.series.list.query({ page: 1, pageSize: 10 });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Re-pull once the page is shown again, e.g. after the user signs in
  // from a navigated-to subpage and comes back.
  useDidShow(() => {
    if (!loading) void load();
  });

  const featured = (data?.items ?? []).slice(0, 4);
  const totalCards = (data?.items ?? []).reduce((acc, s) => acc + s.cardCount, 0);

  return (
    <ScrollView scrollY style={{ height: '100vh' }}>
      <View style={{ padding: '32rpx' }}>
        <BreadcrumbsMini items={[{ label: tt('breadcrumb.home') }]} />

        <View style={{ marginBottom: '32rpx' }}>
          <Text style={{ fontSize: '24rpx', color: '#6b7280', letterSpacing: '3rpx' }}>
            {APP_NAME} · MVP
          </Text>
          <View style={{ height: '8rpx' }} />
          <Text style={{ fontSize: '48rpx', fontWeight: 700, color: '#171717' }}>
            {tt('welcome.title')}
          </Text>
          <View style={{ height: '12rpx' }} />
          <Text style={{ fontSize: '28rpx', color: '#525252' }}>{tt('welcome.subtitle')}</Text>
        </View>

        <View
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '16rpx',
            marginBottom: '40rpx',
            flexWrap: 'wrap',
          }}
        >
          <Link to="/pages/series/list/index">
            <PrimaryButton label={tt('miniapp.home.browse')} />
          </Link>
          <Link to="/pages/search/index/index">
            <PrimaryButton label={tt('miniapp.home.search')} />
          </Link>
          {session.isAuthenticated ? null : (
            <Link to="/pages/auth/login/index">
              <PrimaryButton label={tt('miniapp.home.login')} />
            </Link>
          )}
        </View>

        {session.isAuthenticated && session.user ? (
          <View
            style={{
              padding: '20rpx 24rpx',
              background: '#f1f5f9',
              borderRadius: '16rpx',
              marginBottom: '32rpx',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: '26rpx', color: '#0f172a' }}>
              {tt('miniapp.home.profile', { username: session.user.username })}
            </Text>
            <Text
              style={{ fontSize: '24rpx', color: '#2563eb' }}
              onClick={() => {
                session.signOut();
                void Taro.showToast({ title: tt('miniapp.toast.logoutOk'), icon: 'success' });
              }}
            >
              {tt('miniapp.home.logout')}
            </Text>
          </View>
        ) : null}

        <SectionCard title={tt('miniapp.home.featured')}>
          {loading ? (
            <View>
              <Skeleton height="160rpx" />
              <Skeleton height="160rpx" />
              <Skeleton height="160rpx" />
            </View>
          ) : error ? (
            <View>
              <Text style={{ color: '#dc2626', fontSize: '26rpx' }}>
                {tt('state.error')}: {error}
              </Text>
              <View style={{ height: '16rpx' }} />
              <PrimaryButton label={tt('state.retry')} onClick={load} />
            </View>
          ) : featured.length === 0 ? (
            <Empty title={tt('series.empty')} />
          ) : (
            <View>
              {featured.map((series) => (
                <Link
                  key={series.slug}
                  to={`/pages/series/detail/index?slug=${series.slug}`}
                  style={{ marginBottom: '16rpx' }}
                >
                  <View
                    style={{
                      position: 'relative',
                      overflow: 'hidden',
                      borderRadius: '16rpx',
                      background: gradientFor(series.slug),
                      padding: '32rpx',
                      color: '#ffffff',
                    }}
                  >
                    <Text style={{ display: 'block', fontSize: '34rpx', fontWeight: 600 }}>
                      {series.title}
                    </Text>
                    <View style={{ height: '8rpx' }} />
                    <Text style={{ fontSize: '24rpx', opacity: 0.9 }}>{series.description}</Text>
                    <View style={{ height: '8rpx' }} />
                    <Text style={{ fontSize: '22rpx', opacity: 0.8 }}>
                      {tt('series.cardCount', { count: series.cardCount })}
                    </Text>
                  </View>
                </Link>
              ))}
              <Link to="/pages/series/list/index" style={{ padding: '12rpx 0' }}>
                <Text style={{ color: '#2563eb', fontSize: '26rpx' }}>
                  {tt('miniapp.home.viewAll')}
                </Text>
              </Link>
            </View>
          )}
        </SectionCard>

        <View style={{ height: '24rpx' }} />

        <SectionCard title={`${APP_NAME} · ${tt('home.stats.source')}`}>
          <View style={{ display: 'flex', gap: '16rpx', flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: '220rpx' }}>
              <Text style={{ fontSize: '22rpx', color: '#737373' }}>{tt('home.stats.series')}</Text>
              <View style={{ height: '8rpx' }} />
              <Text style={{ fontSize: '40rpx', fontWeight: 700 }}>{data?.total ?? '—'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: '220rpx' }}>
              <Text style={{ fontSize: '22rpx', color: '#737373' }}>{tt('home.stats.cards')}</Text>
              <View style={{ height: '8rpx' }} />
              <Text style={{ fontSize: '40rpx', fontWeight: 700 }}>{data ? totalCards : '—'}</Text>
            </View>
          </View>
          <View style={{ height: '16rpx' }} />
          <Text style={{ fontSize: '22rpx', color: '#737373' }}>{tt('home.stats.sourceNote')}</Text>
        </SectionCard>
      </View>
    </ScrollView>
  );
});
