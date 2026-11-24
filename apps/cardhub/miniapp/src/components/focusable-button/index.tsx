import { createElement, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@tarojs/components';
import { isWebEnv } from '../../lib/env';

/**
 * Local copy of the #321 / #322 `@repo/ui-mini` FocusableButton contract, for
 * this PR only. After #321 merges we will `git merge origin/main`, delete this
 * file, and import the shared helper.
 *
 * Taro rewrites call-site `ariaLabel` / `ariaChecked` to kebab-case. We pass
 * native `aria-*`, `role`, `id`, and `style` through to the DOM. No global
 * `.h5-focusable` class — #321 found `font: inherit` broke primary buttons.
 */
const CAMEL_TO_KEBAB: Record<string, string> = {
  ariaPressed: 'aria-pressed',
  ariaLabel: 'aria-label',
  ariaChecked: 'aria-checked',
  ariaDisabled: 'aria-disabled',
  ariaExpanded: 'aria-expanded',
  ariaControls: 'aria-controls',
  ariaDescribedBy: 'aria-describedby',
  ariaLabelledBy: 'aria-labelledby',
};

export function nativeAriaProps(rest: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['id', 'style', 'role', 'tabIndex']) {
    if (rest[key] !== undefined) out[key] = rest[key];
  }
  for (const [key, value] of Object.entries(rest)) {
    if (key.startsWith('data-') || key.startsWith('aria-')) out[key] = value;
  }
  for (const [camel, kebab] of Object.entries(CAMEL_TO_KEBAB)) {
    if (out[kebab] === undefined && rest[camel] !== undefined) out[kebab] = rest[camel];
  }
  return out;
}

type FocusableButtonProps = {
  className?: string;
  hoverClass?: string;
  role?: string;
  tabIndex?: number;
  id?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  'aria-label'?: string;
  ariaDisabled?: boolean | 'true' | 'false';
  'aria-disabled'?: boolean | 'true' | 'false';
  ariaChecked?: boolean | 'true' | 'false';
  'aria-checked'?: boolean | 'true' | 'false';
  onClick?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  children?: ReactNode;
  [dataAttr: `data-${string}`]: string | undefined;
};

export function FocusableButton({
  className,
  hoverClass,
  onClick,
  onKeyDown: onKeyDownProp,
  children,
  ...rest
}: FocusableButtonProps) {
  const forwarded = nativeAriaProps(rest as Record<string, unknown>);
  const blocked = forwarded['aria-disabled'] === true || forwarded['aria-disabled'] === 'true';
  const tabIndex = (rest.tabIndex as number | undefined) ?? 0;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    onKeyDownProp?.(event);
    if (event.defaultPrevented || blocked) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onClick?.();
    }
  };

  if (isWebEnv()) {
    return createElement(
      'button',
      {
        type: 'button',
        className,
        tabIndex: blocked ? -1 : tabIndex,
        ...forwarded,
        'aria-disabled': blocked ? true : forwarded['aria-disabled'],
        onClick: blocked ? undefined : onClick,
        onKeyDown,
      },
      children,
    );
  }

  return (
    <Button
      className={className}
      hoverClass={hoverClass ?? 'none'}
      {...(forwarded as Record<string, unknown>)}
      onClick={blocked ? undefined : onClick}
    >
      {children}
    </Button>
  );
}

const HOLD_MS = [0, 16, 50, 100, 200, 400, 500];

/**
 * Focus, then retry for 500ms. Taro H5 often focuses the control and then
 * blurs to BODY on the same tick (CH-301 §2 / §4). If focus is still on
 * BODY within the hold window, put it back.
 */
export function focusWhenSettled(getEl: () => HTMLElement | null): () => void {
  if (typeof document === 'undefined') return () => undefined;
  let cancelled = false;
  const started = Date.now();
  const tryFocus = () => {
    if (cancelled) return;
    const el = getEl();
    if (!el) return;
    const active = document.activeElement;
    if (active === el || (active && el.contains(active))) return;
    const panel = el.closest('.card-comment__confirm, .report-entry__form');
    if (panel && active && panel.contains(active)) return;
    if (
      active &&
      active !== document.body &&
      active !== document.documentElement &&
      Date.now() - started > 80
    ) {
      return;
    }
    el.focus();
  };
  tryFocus();
  const timers = HOLD_MS.map((ms) => window.setTimeout(tryFocus, ms));
  const onFocusOut = () => {
    if (cancelled || Date.now() - started > 500) return;
    const active = document.activeElement;
    if (active === document.body || active === document.documentElement || !active) {
      tryFocus();
    }
  };
  document.addEventListener('focusout', onFocusOut, true);
  return () => {
    cancelled = true;
    timers.forEach((id) => window.clearTimeout(id));
    document.removeEventListener('focusout', onFocusOut, true);
  };
}

export function focusSelector(selector: string): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>(selector);
  el?.focus();
}
