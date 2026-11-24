import { View, Text } from '@tarojs/components';
import { Link, type LinkMode } from './link';

export interface BreadcrumbItem {
  label: string;
  /** When set the item is rendered as a link (`Taro.navigateTo` by default). */
  to?: string;
  /** Tab pages (tabBar) only accept `switchTab`. Defaults to `navigate`. */
  mode?: LinkMode;
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
        color: '#525252',
      }}
    >
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        const separator = idx > 0 ? ' / ' : '';
        const label = `${separator}${item.label}`;
        if (item.to && !last) {
          return (
            <Link key={`${idx}-${item.label}`} to={item.to} mode={item.mode}>
              <Text style={{ color: '#2563eb' }}>{label}</Text>
            </Link>
          );
        }
        return (
          <Text key={`${idx}-${item.label}`} style={{ color: last ? '#171717' : '#525252' }}>
            {label}
          </Text>
        );
      })}
    </View>
  );
}
