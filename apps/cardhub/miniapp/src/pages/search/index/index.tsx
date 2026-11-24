import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ScrollView, View, Text, Input } from '@tarojs/components';
import { BreadcrumbsMini, Empty, Link, RarityBadge, Skeleton, type Rarity } from '@repo/ui-mini';
import { cardSearchHint, hasCardSearchConditions, parseCardSearchQuery, t } from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { ArtworkMini } from '../../../components/artwork-mini';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import './index.scss';

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
  // `hint` is local parser copy; `failure` is a failed request (red box + retry).
  const [hint, setHint] = useState<string | null>(null);
  const [failure, setFailure] = useState<Notice<object> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastQueryRef = useRef('');
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
    if (lastQueryRef.current !== debounced) {
      lastQueryRef.current = debounced;
      setFailure(null);
    }
    if (debounced.length === 0) {
      setResults(null);
      setHint(null);
      return;
    }
    const parsed = parseCardSearchQuery(debounced);
    const hint = cardSearchHint(parsed);
    const hintText = hint
      ? hint.reason === 'unknownPrefix'
        ? tt('search.unsupportedPrefix', { token: hint.token })
        : hint.reason === 'invalidYear'
          ? tt('search.ignoredYear', { token: hint.token })
          : hint.reason === 'cardNumberTooLong'
            ? tt('search.ignoredCardNumber', { token: hint.token })
            : tt('search.invalidRarity', {
                value: hint.token.includes(':')
                  ? hint.token.slice(hint.token.indexOf(':') + 1)
                  : hint.token,
              })
      : null;
    if (!parsed.ok) {
      setHint(hintText);
      setLoading(false);
      return;
    }
    if (!hasCardSearchConditions(parsed)) {
      setResults(null);
      setHint(hintText);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setHint(hintText);
    trpc.cards.search
      .query({ q: debounced, limit: 30 })
      .then((res) => {
        if (cancelled) return;
        setResults(res);
        setFailure(null);
      })
      .catch(() => {
        if (!cancelled) setFailure({ id: nextNoticeId() });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, attempt]);

  return (
    <ScrollView scrollY className="search-page">
      <View className="search-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('nav.search') },
          ]}
        />

        <Text className="search-page__title">{tt('nav.search')}</Text>
        <Input
          className="search-page__input"
          value={query}
          placeholder={tt('search.placeholder')}
          confirmType="search"
          onInput={(e) => setQuery(e.detail.value)}
        />

        {debounced === '' ? (
          <Empty description={tt('search.placeholder')} />
        ) : failure ? (
          <ErrorBoxMini
            key={failure.id}
            title={tt('search.loadFailed')}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={loading}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : loading ? (
          <View>
            <Skeleton height="120rpx" />
            <Skeleton height="120rpx" />
            <Skeleton height="120rpx" />
          </View>
        ) : hint ? (
          <View className="search-page__hint">
            <Text className="search-page__hint-text">{hint}</Text>
          </View>
        ) : !results || results.results.length === 0 ? (
          <Empty title={tt('search.empty')} />
        ) : (
          <View>
            {results.results.map((card) => (
              <Link
                key={card.slug}
                to={`/pages/cards/detail/index?slug=${card.slug}`}
                className="search-result"
              >
                <View className="search-result__art">
                  <ArtworkMini
                    src={card.imageUrl}
                    slug={card.slug}
                    ratio="card"
                    mode="aspectFill"
                    label={card.name}
                  />
                </View>
                <View className="search-result__text">
                  <Text className="search-result__name">{card.name}</Text>
                  <Text className="search-result__series">{card.seriesTitle}</Text>
                </View>
                <RarityBadge rarity={normalizeRarity(card.rarity)} locale={locale.locale} />
              </Link>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
});
