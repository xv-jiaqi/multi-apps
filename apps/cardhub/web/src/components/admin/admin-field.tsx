import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

export function AdminField({
  id,
  label,
  hint,
  error,
  count,
  max,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  count?: number;
  max?: number;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      {control}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {hint ? (
            <p id={hintId} className="text-xs text-neutral-600">
              {hint}
            </p>
          ) : null}
          {error ? (
            <p id={errorId} className="text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>
        {max !== undefined && count !== undefined ? (
          <span aria-live="off" className="shrink-0 text-xs text-neutral-500">
            {count}/{max}
          </span>
        ) : null}
      </div>
    </div>
  );
}
