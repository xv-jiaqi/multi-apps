import { useEffect, useState } from 'react';
import { View, Text } from '@tarojs/components';
import { PrimaryButton, SectionCard } from '@repo/ui-mini';
import { APP_NAME, DEFAULT_LOCALE, t } from '@repo/shared';
import { trpc } from '../../lib/trpc';

type PingResult = Awaited<ReturnType<typeof trpc.health.ping.query>>;

export default function Index() {
  const [data, setData] = useState<PingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.health.ping.query();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <View style={{ padding: '32rpx' }}>
      <View style={{ marginBottom: '32rpx' }}>
        <Text style={{ fontSize: '48rpx', fontWeight: 700 }}>
          {t(DEFAULT_LOCALE, 'welcome.title')}
        </Text>
        <View style={{ height: '12rpx' }} />
        <Text style={{ fontSize: '28rpx', color: '#6b7280' }}>
          {t(DEFAULT_LOCALE, 'welcome.subtitle')}
        </Text>
      </View>

      <SectionCard title={`${APP_NAME} · 端到端类型安全演示`}>
        {loading ? (
          <Text style={{ color: '#9ca3af' }}>loading…</Text>
        ) : error ? (
          <Text style={{ color: '#dc2626' }}>
            {t(DEFAULT_LOCALE, 'health.fail')}: {error}
          </Text>
        ) : data ? (
          <View>
            <Text>status: {data.status}</Text>
            <View style={{ height: '8rpx' }} />
            <Text>message: {data.message}</Text>
            <View style={{ height: '8rpx' }} />
            <Text>timestamp: {new Date(data.timestamp).toLocaleString()}</Text>
          </View>
        ) : null}
        <View style={{ height: '24rpx' }} />
        <PrimaryButton label="重新检查" onClick={refresh} />
      </SectionCard>
    </View>
  );
}
