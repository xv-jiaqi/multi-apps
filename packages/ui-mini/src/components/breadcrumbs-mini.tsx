import { View, Text } from '@tarojs/components';
import { Link } from './link';

export interface BreadcrumbItem {
  label: string;
  /** When set the item is rendered as a `Taro.navigateTo` link. */
  to?: string;
}

export interface BreadcrumbsMiniProps {
  items: readonly BreadcrumbItem[];
}

/**
 * Mini-program breadcrumb trail. Uses `Link` (Taro.navigateTo) for
 * navigable items and plain `Text` for the current page, matching
 * the web breadcrumb pattern.
 */
export function BreadcrumbsMini({ items }: BreadcrumbsMiniProps) {
  return (
    <View
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8rpx',
        marginBottom: '16rpx',
        fontSize: '24rpx',
        color: '#6b7280',
      }}
    >
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        const separator = idx > 0 ? ' / ' : '';
        const label = `${separator}${item.label}`;
        if (item.to && !last) {
          return (
            <Link key={`${idx}-${item.label}`} to={item.to}>
              <Text style={{ color: '#2563eb' }}>{label}</Text>
            </Link>
          );
        }
        return (
          <Text key={`${idx}-${item.label}`} style={{ color: last ? '#171717' : '#6b7280' }}>
            {label}
          </Text>
        );
      })}
    </View>
  );
}
