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
 */
export function PrimaryButton({ label, className, hoverClass, ...rest }: PrimaryButtonProps) {
  return (
    <Button
      {...rest}
      className={['primary-button', className].filter(Boolean).join(' ')}
      hoverClass={hoverClass ?? 'primary-button--pressed'}
      type="default"
    >
      {label}
    </Button>
  );
}
