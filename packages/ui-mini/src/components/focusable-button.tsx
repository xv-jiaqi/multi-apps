import { Button } from '@tarojs/components';
import type { ButtonProps } from '@tarojs/components';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import Taro from '@tarojs/taro';

/**
 * Taro H5's `taro-button-core` / `taro-view-core` are custom elements, so
 * their default `tabIndex` is -1 and they are not in the tab order (CH-301
 * §5). On H5 we render a real `<button>` / use these helpers so Tab, Enter
 * and Space work. Weapp keeps the Taro components.
 *
 * Taro's compiler rewrites call-site `ariaLabel` / `ariaPressed` /
 * `ariaChecked` into kebab-case (`aria-label`, …). Read both forms, or the
 * value is undefined and never reaches the DOM.
 */
export function isMiniappWebEnv(): boolean {
  const env = typeof Taro.getEnv === 'function' ? String(Taro.getEnv()) : '';
  return env === '' || env === 'WEB';
}

export function activateOnEnterOrSpace(
  onActivate: ((event: unknown) => void) | undefined,
  disabled?: boolean,
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || !onActivate) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onActivate(event);
    }
  };
}

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
  if (rest.id != null) out.id = rest.id;
  if (rest.style != null) out.style = rest.style;
  if (rest.role != null) out.role = rest.role;
  if (rest.tabIndex !== undefined) out.tabIndex = rest.tabIndex;
  for (const [key, value] of Object.entries(rest)) {
    if (key.startsWith('data-') || key.startsWith('aria-')) out[key] = value;
  }
  for (const [camel, kebab] of Object.entries(CAMEL_TO_KEBAB)) {
    if (out[kebab] === undefined && rest[camel] !== undefined) out[kebab] = rest[camel];
  }
  return out;
}

export interface FocusableButtonProps extends Omit<ButtonProps, 'ariaChecked' | 'style' | 'id'> {
  children?: ReactNode;
  style?: CSSProperties | string;
  id?: string;
  role?: string;
  ariaPressed?: boolean;
  'aria-pressed'?: boolean;
  ariaLabel?: string;
  'aria-label'?: string;
  ariaChecked?: boolean | 'mixed';
  'aria-checked'?: boolean | 'mixed';
  'aria-disabled'?: boolean;
  'data-testid'?: string;
  tabIndex?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

export function FocusableButton({
  children,
  className,
  hoverClass,
  disabled,
  onClick,
  onKeyDown,
  tabIndex,
  ...rest
}: FocusableButtonProps) {
  const forwarded = nativeAriaProps(rest as Record<string, unknown>);
  const ariaBlocked = forwarded['aria-disabled'] === true || forwarded['aria-disabled'] === 'true';
  const isDisabled = Boolean(disabled) || ariaBlocked;
  if (isMiniappWebEnv()) {
    return (
      <button
        type="button"
        className={['h5-focusable', className].filter(Boolean).join(' ')}
        disabled={disabled ? true : undefined}
        {...forwarded}
        tabIndex={isDisabled ? -1 : (tabIndex ?? 0)}
        aria-disabled={isDisabled ? true : (forwarded['aria-disabled'] as boolean | undefined)}
        onClick={
          isDisabled
            ? undefined
            : (onClick as ((event: MouseEvent<HTMLButtonElement>) => void) | undefined)
        }
        onKeyDown={
          isDisabled
            ? undefined
            : (event: KeyboardEvent<HTMLButtonElement>) => {
                onKeyDown?.(event);
                if (event.defaultPrevented) return;
                activateOnEnterOrSpace(onClick as ((event: unknown) => void) | undefined)(event);
              }
        }
      >
        {children}
      </button>
    );
  }
  return (
    <Button
      {...(rest as ButtonProps)}
      className={className}
      hoverClass={hoverClass}
      type="default"
      {...(tabIndex !== undefined ? ({ tabIndex } as ButtonProps) : {})}
      {...(isDisabled
        ? ({
            disabled: true,
            ariaDisabled: true,
            'aria-disabled': true,
          } as ButtonProps)
        : {
            ...(onClick ? { onClick } : {}),
            ...(onKeyDown ? { onKeyDown } : {}),
          })}
    >
      {children}
    </Button>
  );
}
