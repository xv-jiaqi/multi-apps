import type { ButtonProps } from '@tarojs/components';
import { FocusableButton } from './focusable-button';

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
 *
 * On H5 this renders a real `<button>` so it is in the tab order (CH-301
 * §5): `taro-button-core` has a default tabIndex of -1.
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
    <FocusableButton
      {...rest}
      className={['primary-button', isDisabled ? 'primary-button--disabled' : '', className]
        .filter(Boolean)
        .join(' ')}
      hoverClass={hoverClass ?? 'primary-button--pressed'}
      disabled={isDisabled ? true : undefined}
      aria-disabled={isDisabled ? true : undefined}
      onClick={isDisabled ? undefined : onClick}
    >
      {label}
    </FocusableButton>
  );
}
