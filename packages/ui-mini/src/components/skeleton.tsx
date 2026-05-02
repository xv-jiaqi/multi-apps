import { View } from '@tarojs/components';

export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  marginBottom?: string;
}

/**
 * Lightweight loading placeholder. We avoid CSS animations because the
 * weapp runtime has inconsistent `@keyframes` support across versions;
 * the gray tone alone reads clearly as "loading".
 */
export function Skeleton({
  width = '100%',
  height = '48rpx',
  radius = '12rpx',
  marginBottom = '16rpx',
}: SkeletonProps) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        marginBottom,
        background: 'linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%)',
      }}
    />
  );
}
