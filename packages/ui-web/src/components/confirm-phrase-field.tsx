import * as React from 'react';
import { cn } from '../lib/cn';

export function isConfirmPhraseValid(value: string, requiredPhrase: string): boolean {
  return value.trim() === requiredPhrase;
}

export interface ConfirmPhraseFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'autoCapitalize' | 'autoComplete' | 'className' | 'id' | 'onChange' | 'spellCheck' | 'value'
> {
  id: string;
  label: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  description?: React.ReactNode;
  descriptionId?: string;
  className?: string;
  inputClassName?: string;
}

export const ConfirmPhraseField = React.forwardRef<HTMLInputElement, ConfirmPhraseFieldProps>(
  (
    {
      id,
      label,
      value,
      onValueChange,
      description,
      descriptionId,
      className,
      inputClassName,
      ...props
    },
    ref,
  ) => (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby={descriptionId}
        className={cn(
          'flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-900 shadow-sm placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          inputClassName,
        )}
        {...props}
      />
      {description ? (
        <p id={descriptionId} className="text-xs text-neutral-600">
          {description}
        </p>
      ) : null}
    </div>
  ),
);
ConfirmPhraseField.displayName = 'ConfirmPhraseField';
