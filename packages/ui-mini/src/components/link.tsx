import type { CSSProperties, KeyboardEvent, MouseEvent, PropsWithChildren } from 'react';
import { View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { rpxStyle } from '../rpx';
import { activateOnEnterOrSpace, isMiniappWebEnv } from './focusable-button';

export type LinkMode = 'navigate' | 'redirect' | 'switchTab' | 'back';

/** Taro H5 uses a hash router; a raw `/pages/...` href 404s in a new tab. */
export function hashHref(to?: string): string {
  if (!to) return '#';
  if (to.startsWith('#')) return to;
  return `#${to.startsWith('/') ? to : `/${to}`}`;
}

export interface LinkProps {
  to?: string;
  mode?: LinkMode;
  /** Optional `delta` used for `mode="back"`. Defaults to 1. */
  delta?: number;
  disabled?: boolean;
  style?: CSSProperties;
  className?: string;
  onBefore?: () => void;
}

/**
 * Lightweight `Link` wrapper around Taro's programmatic navigation so page
 * code reads like the web version (where `<Link to="/cards/foo" />` is
 * native). Accepts a `mode` flag to cover `navigateTo` / `redirectTo` /
 * `switchTab` / `navigateBack`.
 *
 * On H5 this renders a real `<a>` with tabIndex 0 so it can be Tab-focused
 * (CH-301 §5). Taro's `View` is a custom element whose default tabIndex is
 * -1. Enter and Space both activate the navigation.
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
  const handleActivate = () => {
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

  const mergedStyle = rpxStyle({
    cursor: 'pointer',
    opacity: disabled ? 0.5 : 1,
    ...style,
  });

  if (isMiniappWebEnv()) {
    const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      handleActivate();
    };
    const onKeyDown = activateOnEnterOrSpace(() => handleActivate(), disabled);
    return (
      <a
        href={hashHref(to)}
        role="link"
        className={['h5-focusable-link', className].filter(Boolean).join(' ')}
        style={mergedStyle}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled ? true : undefined}
        onClick={disabled ? undefined : onClick}
        onKeyDown={
          disabled ? undefined : (onKeyDown as (event: KeyboardEvent<HTMLAnchorElement>) => void)
        }
      >
        {children}
      </a>
    );
  }

  return (
    <View
      hoverClass="ui-mini-link--hover"
      hoverStayTime={80}
      onClick={handleActivate}
      className={className}
      style={mergedStyle}
    >
      {children}
    </View>
  );
}
