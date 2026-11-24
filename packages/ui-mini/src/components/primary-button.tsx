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
 */
export function PrimaryButton({
  label,
  className,
  hoverClass,
  disabled,
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
      {...(isDisabled ? { disabled: true } : {})}
    >
      {label}
    </Button>
  );
}
