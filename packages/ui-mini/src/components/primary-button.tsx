import { Button } from '@tarojs/components';
import type { ButtonProps } from '@tarojs/components';

export interface PrimaryButtonProps extends ButtonProps {
  label: string;
}

export function PrimaryButton({ label, ...rest }: PrimaryButtonProps) {
  return (
    <Button type="primary" {...rest}>
      {label}
    </Button>
  );
}
