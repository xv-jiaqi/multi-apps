import * as React from 'react';
import { cn } from '../lib/cn';

export interface SegmentedControlOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  legend: React.ReactNode;
  legendSrOnly?: boolean;
  name: string;
  value: string;
  options: SegmentedControlOption[];
  onValueChange: (value: string) => void;
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl({
  legend,
  legendSrOnly = false,
  name,
  value,
  options,
  onValueChange,
  fullWidth = false,
  className,
}: SegmentedControlProps) {
  return (
    <fieldset className={cn(fullWidth && 'w-full', className)}>
      <legend
        className={cn(legendSrOnly ? 'sr-only' : 'mb-1 text-xs font-medium text-neutral-600')}
      >
        {legend}
      </legend>
      <div
        className={cn(
          'inline-flex h-10 items-center gap-1 rounded-md bg-neutral-100 p-1',
          fullWidth && 'w-full',
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'relative inline-flex h-8 cursor-pointer items-center rounded-sm px-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-white/70',
              'has-[:checked]:bg-brand-600 has-[:checked]:text-white',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-2',
              'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
              fullWidth && 'flex-1 justify-center',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
