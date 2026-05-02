import { View, Text } from '@tarojs/components';

export interface EmptyProps {
  title?: string;
  description?: string;
}

/** Empty-state placeholder used across miniapp list / search screens. */
export function Empty({ title, description }: EmptyProps) {
  return (
    <View
      style={{
        padding: '64rpx 32rpx',
        border: '2rpx dashed #d4d4d4',
        borderRadius: '24rpx',
        background: 'rgba(255,255,255,0.6)',
        textAlign: 'center',
      }}
    >
      {title ? (
        <Text
          style={{
            display: 'block',
            fontSize: '32rpx',
            fontWeight: 600,
            color: '#525252',
            marginBottom: '12rpx',
          }}
        >
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text style={{ fontSize: '26rpx', color: '#737373' }}>{description}</Text>
      ) : null}
    </View>
  );
}
