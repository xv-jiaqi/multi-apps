import type { PropsWithChildren } from 'react';
import { View } from '@tarojs/components';
import Taro from '@tarojs/taro';

export type LinkMode = 'navigate' | 'redirect' | 'switchTab' | 'back';

export interface LinkProps {
  to?: string;
  mode?: LinkMode;
  /** Optional `delta` used for `mode="back"`. Defaults to 1. */
  delta?: number;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onBefore?: () => void;
}

/**
 * Lightweight `Link` wrapper around Taro's programmatic navigation so page
 * code reads like the web version (where `<Link to="/cards/foo" />` is
 * native). Accepts a `mode` flag to cover `navigateTo` / `redirectTo` /
 * `switchTab` / `navigateBack`.
 */
export function Link({
  to,
  mode = 'navigate',
  delta,
  disabled,
  style,
  className,
  onBefore,
  children,
}: PropsWithChildren<LinkProps>) {
  const handleClick = () => {
    if (disabled) return;
    onBefore?.();
    if (mode === 'back') {
      void Taro.navigateBack({ delta: delta ?? 1 });
      return;
    }
    if (!to) return;
    if (mode === 'redirect') {
      void Taro.redirectTo({ url: to });
    } else if (mode === 'switchTab') {
      void Taro.switchTab({ url: to });
    } else {
      void Taro.navigateTo({ url: to });
    }
  };

  return (
    <View
      hoverClass="ui-mini-link--hover"
      hoverStayTime={80}
      onClick={handleClick}
      className={className}
      style={{
        cursor: 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </View>
  );
}
