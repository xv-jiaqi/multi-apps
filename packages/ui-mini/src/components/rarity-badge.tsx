import { View, Text } from '@tarojs/components';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

const RARITY_STYLE: Record<
  Rarity,
  { background: string; color: string; label: { 'zh-CN': string; 'en-US': string } }
> = {
  common: {
    background: '#f5f5f5',
    color: '#525252',
    label: { 'zh-CN': '普通', 'en-US': 'Common' },
  },
  rare: {
    background: '#e0f2fe',
    color: '#0369a1',
    label: { 'zh-CN': '稀有', 'en-US': 'Rare' },
  },
  epic: {
    background: '#ede9fe',
    color: '#6d28d9',
    label: { 'zh-CN': '史诗', 'en-US': 'Epic' },
  },
  legendary: {
    background: 'linear-gradient(90deg, #fde68a 0%, #fdba74 100%)',
    color: '#92400e',
    label: { 'zh-CN': '传说', 'en-US': 'Legendary' },
  },
};

export interface RarityBadgeProps {
  rarity: Rarity;
  locale: 'zh-CN' | 'en-US';
}

/**
 * Mirror of `apps/cardhub/web/src/components/rarity-badge.tsx`. Uses inline
 * styles rather than Tailwind utilities because miniapp has no JIT class
 * compilation.
 */
export function RarityBadge({ rarity, locale }: RarityBadgeProps) {
  const style = RARITY_STYLE[rarity];
  return (
    <View
      style={{
        display: 'inline-block',
        padding: '4rpx 20rpx',
        borderRadius: '9999rpx',
        background: style.background,
        fontSize: '22rpx',
      }}
    >
      <Text style={{ color: style.color, fontWeight: 500 }}>{style.label[locale]}</Text>
    </View>
  );
}
