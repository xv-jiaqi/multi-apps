import type { PropsWithChildren } from 'react';
import { View, Text } from '@tarojs/components';

export interface SectionCardProps {
  title?: string;
}

export function SectionCard({ title, children }: PropsWithChildren<SectionCardProps>) {
  return (
    <View
      className="section-card"
      style={{ padding: '32rpx', background: '#fff', borderRadius: '16rpx' }}
    >
      {title ? (
        <Text className="section-card__title" style={{ fontSize: '32rpx', fontWeight: 600 }}>
          {title}
        </Text>
      ) : null}
      <View className="section-card__body" style={{ marginTop: title ? '16rpx' : 0 }}>
        {children}
      </View>
    </View>
  );
}
