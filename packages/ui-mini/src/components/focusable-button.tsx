import { Button } from '@tarojs/components';
import type { ButtonProps } from '@tarojs/components';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import Taro from '@tarojs/taro';

/**
 * Taro H5's `taro-button-core` / `taro-view-core` are custom elements, so
 * their default `tabIndex` is -1 and they are not in the tab order (CH-301
 * §5). On H5 we render a real `<button>` / use these helpers so Tab, Enter
 * and Space work. Weapp keeps the Taro components.
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

export interface FocusableButtonProps extends ButtonProps {
  children?: ReactNode;
  ariaPressed?: boolean;
  'aria-pressed'?: boolean;
  ariaLabel?: string;
  'aria-label'?: string;
}

export function FocusableButton({
  children,
  className,
  hoverClass,
  disabled,
  onClick,
  ...rest
}: FocusableButtonProps) {
  const isDisabled = Boolean(disabled);
  if (isMiniappWebEnv()) {
    const restRecord = rest as Record<string, unknown>;
    const ariaPressed = (restRecord['aria-pressed'] ?? restRecord.ariaPressed) as
      | boolean
      | undefined;
    const ariaLabel = (restRecord['aria-label'] ?? restRecord.ariaLabel) as string | undefined;
    return (
      <button
        type="button"
        className={['h5-focusable', className].filter(Boolean).join(' ')}
        disabled={isDisabled ? true : undefined}
        aria-disabled={isDisabled ? true : undefined}
        aria-pressed={ariaPressed}
        aria-label={ariaLabel}
        tabIndex={isDisabled ? -1 : 0}
        onClick={
          isDisabled
            ? undefined
            : (onClick as ((event: MouseEvent<HTMLButtonElement>) => void) | undefined)
        }
      >
        {children}
      </button>
    );
  }
  return (
    <Button
      {...rest}
      className={className}
      hoverClass={hoverClass}
      type="default"
      {...(isDisabled
        ? ({
            disabled: true,
            ariaDisabled: true,
            'aria-disabled': true,
          } as ButtonProps)
        : onClick
          ? { onClick }
          : {})}
    >
      {children}
    </Button>
  );
}
