import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ScrollView, View, Text, Input } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, RarityBadge, Skeleton, type Rarity } from '@repo/ui-mini';
import { hasCardSearchConditions, parseCardSearchQuery, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { gradientFor } from '../../../lib/gradients';

type SearchResult = Awaited<ReturnType<typeof trpc.cards.search.query>>;

const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

function normalizeRarity(rarity: string | null): Rarity {
  if (rarity && (RARITY_ORDER as readonly string[]).includes(rarity)) {
    return rarity as Rarity;
  }
  return 'common';
}

export default observer(function SearchPage() {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the query by 250ms to match web UX.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(query.trim()), 250);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  useEffect(() => {
    if (debounced.length === 0) {
      setResults(null);
      setError(null);
      return;
    }
    const parsed = parseCardSearchQuery(debounced);
    if (!parsed.ok) {
      const colon = parsed.token.indexOf(':');
      setError(
        parsed.reason === 'unknownPrefix'
          ? tt('search.unsupportedPrefix', { token: parsed.token })
          : tt('search.invalidRarity', {
              value: colon >= 0 ? parsed.token.slice(colon + 1) : parsed.token,
            }),
      );
      setLoading(false);
      return;
    }
    if (!hasCardSearchConditions(parsed)) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    trpc.cards.search
      .query({ q: debounced, limit: 30 })
      .then((res) => {
        if (!cancelled) setResults(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <ScrollView scrollY style={{ height: '100vh' }}>
      <View style={{ padding: '32rpx' }}>
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index' },
            { label: tt('nav.search') },
          ]}
        />

        <Text style={{ fontSize: '40rpx', fontWeight: 700, color: '#171717', display: 'block' }}>
          {tt('nav.search')}
        </Text>
        <View style={{ height: '16rpx' }} />
        <Input
          value={query}
          placeholder={tt('search.placeholder')}
          confirmType="search"
          onInput={(e) => setQuery(e.detail.value)}
          style={{
            width: '100%',
            padding: '20rpx 24rpx',
            fontSize: '28rpx',
            background: '#ffffff',
            border: '1rpx solid #e5e7eb',
            borderRadius: '16rpx',
            boxSizing: 'border-box',
          }}
        />
        <View style={{ height: '24rpx' }} />

        {debounced === '' ? (
          <Empty description={tt('search.placeholder')} />
        ) : loading ? (
          <View>
            <Skeleton height="100rpx" />
            <Skeleton height="100rpx" />
            <Skeleton height="100rpx" />
          </View>
        ) : error ? (
          <View
            style={{
              padding: '32rpx',
              background: '#fef2f2',
              borderRadius: '16rpx',
              border: '1rpx solid #fecaca',
            }}
          >
            <Text style={{ color: '#b91c1c', fontSize: '26rpx' }}>{error}</Text>
          </View>
        ) : !results || results.results.length === 0 ? (
          <Empty title={tt('search.empty')} />
        ) : (
          <View>
            {results.results.map((card) => (
              <Link
                key={card.slug}
                to={`/pages/cards/detail/index?slug=${card.slug}`}
                style={{ marginBottom: '12rpx' }}
              >
                <View
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16rpx',
                    background: '#ffffff',
                    borderRadius: '16rpx',
                    border: '1rpx solid #f1f5f9',
                  }}
                >
                  <View
                    style={{
                      width: '80rpx',
                      height: '80rpx',
                      borderRadius: '12rpx',
                      background: gradientFor(card.slug),
                      flexShrink: 0,
                    }}
                  />
                  <View style={{ flex: 1, marginLeft: '20rpx', minWidth: 0 }}>
                    <Text
                      style={{
                        fontSize: '28rpx',
                        fontWeight: 600,
                        color: '#171717',
                        display: 'block',
                      }}
                    >
                      {card.name}
                    </Text>
                    <Text style={{ fontSize: '22rpx', color: '#737373' }}>{card.seriesTitle}</Text>
                  </View>
                  <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
                </View>
              </Link>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
});
