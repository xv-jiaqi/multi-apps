import { createElement, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@tarojs/components';
import { isWebEnv } from '../../lib/env';

/**
 * Local focusable control for the report / card-comment surfaces in this PR.
 * Does not change `@repo/ui-mini` PrimaryButton or Link (#321 may patch those).
 * Taro H5's `taro-button-core` is often `tabIndex=-1`; on WEB we render a
 * native `<button tabIndex={0}>` so Tab / Enter / Space work.
 */
export function FocusableButton({
  className,
  ariaLabel,
  ariaDisabled,
  ariaChecked,
  role = 'button',
  tabIndex = 0,
  autoFocus,
  onClick,
  children,
  ...dataAttrs
}: {
  className?: string;
  ariaLabel?: string;
  ariaDisabled?: boolean;
  ariaChecked?: boolean;
  role?: string;
  tabIndex?: number;
  autoFocus?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  [dataAttr: `data-${string}`]: string | undefined;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const blocked = Boolean(ariaDisabled);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.tabIndex = tabIndex;
    if (autoFocus) el.focus();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (blocked) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };

  if (isWebEnv()) {
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(dataAttrs)) {
      if (key.startsWith('data-') && value != null) extra[key] = String(value);
    }
    return createElement(
      'button',
      {
        type: 'button',
        className,
        tabIndex,
        role,
        'aria-label': ariaLabel,
        'aria-disabled': blocked ? true : undefined,
        'aria-checked': ariaChecked,
        autoFocus,
        ref,
        onClick: blocked ? undefined : onClick,
        onKeyDown,
        ...extra,
      },
      children,
    );
  }

  return (
    <Button
      className={className}
      hoverClass="none"
      ariaRole={role}
      ariaLabel={ariaLabel}
      onClick={blocked ? undefined : onClick}
    >
      {children}
    </Button>
  );
}

export function focusSelector(selector: string): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>(selector);
  el?.focus();
}
