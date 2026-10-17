import * as React from 'react';
import { cn } from '../lib/cn';
import { controlBase, controlSm } from './form-styles';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'default' | 'sm';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = 'default', ...props }, ref) => (
    <input
      ref={ref}
      className={cn(controlBase, size === 'sm' && controlSm, className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
