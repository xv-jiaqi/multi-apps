import { Button } from '@tarojs/components';
import type { ButtonProps } from '@tarojs/components';

export interface PrimaryButtonProps extends ButtonProps {
  label: string;
}

/**
 * Token-colored primary action. Colors live in the miniapp `app.scss`
 * `.primary-button` rules (CH-301 §5): `$color-brand-600` / `$color-white`
 * at rest, `$color-brand-700` pressed, `$color-neutral-100` /
 * `$color-neutral-600` disabled. Do not set `type="primary"` — that is
 * WeChat's default green, which fails WCAG 1.4.3.
 *
 * Taro H5 writes `disabled="false"` when the prop is the boolean `false`,
 * and CSS `[disabled]` still matches that attribute. Only pass `disabled`
 * when it is true, and hang the disabled styles on a class.
 *
 * Taro H5 also still fires `onClick` on a disabled button. Do not pass
 * `onClick` while disabled, and set `aria-disabled` so assistive tech
 * matches the visual state.
 */
export function PrimaryButton({
  label,
  className,
  hoverClass,
  disabled,
  onClick,
  ...rest
}: PrimaryButtonProps) {
  const isDisabled = Boolean(disabled);
  return (
    <Button
      {...rest}
      className={['primary-button', isDisabled ? 'primary-button--disabled' : '', className]
        .filter(Boolean)
        .join(' ')}
      hoverClass={hoverClass ?? 'primary-button--pressed'}
      type="default"
      {...(isDisabled
        ? ({
            disabled: true,
            // Taro ButtonProps typings omit aria-disabled; both forms so H5
            // and assistive tech can see the state.
            ariaDisabled: true,
            'aria-disabled': true,
          } as ButtonProps)
        : onClick
          ? { onClick }
          : {})}
    >
      {label}
    </Button>
  );
}
