import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@repo/ui-web';
import { focusRing } from './catalog-utils';

export const actionClass = `inline-flex min-h-6 items-center rounded px-1 ${focusRing}`;

export function AdminTable({
  caption,
  busy,
  children,
}: {
  caption: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table aria-busy={busy || undefined} className="w-full min-w-160 text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function AdminTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium text-neutral-600">
      <tr>{children}</tr>
    </thead>
  );
}

export function AdminTh({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn('whitespace-nowrap px-3 py-2', align === 'right' && 'text-right')}
    >
      {children}
    </th>
  );
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600">
      {children}
    </div>
  );
}

export function AdminErrorBox({
  title,
  onRetry,
  retrying,
  retryLabel,
  loadingLabel,
}: {
  title: string;
  onRetry: () => void;
  retrying: boolean;
  retryLabel: string;
  loadingLabel: string;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
      <p className="font-medium">{title}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        aria-busy={retrying || undefined}
        className={`mt-3 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50 ${focusRing}`}
      >
        {retrying ? loadingLabel : retryLabel}
      </button>
    </div>
  );
}

export function AdminStatus({
  message,
  statusRef,
}: {
  message: string | null;
  statusRef: RefObject<HTMLParagraphElement | null>;
}) {
  if (!message) return null;
  return (
    <p
      ref={statusRef}
      role="status"
      tabIndex={-1}
      className={`rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 focus:outline-none ${focusRing}`}
    >
      {message}
    </p>
  );
}

export function AdminConfirmRow({
  colSpan,
  label,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  colSpan: number;
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const promptId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <tr>
      <td colSpan={colSpan} className="px-3 pb-2">
        <div
          role="group"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !disabled) {
              event.stopPropagation();
              onCancel();
            }
          }}
          className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs"
        >
          <span id={promptId} className="mr-auto text-red-700">
            {label}
          </span>
          <button
            type="button"
            aria-describedby={promptId}
            disabled={disabled}
            onClick={onConfirm}
            className={`inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-600 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50 ${focusRing}`}
          >
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            disabled={disabled}
            onClick={onCancel}
            className={`inline-flex min-h-6 items-center rounded px-1 text-neutral-600 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          >
            {cancelLabel}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function InlineConfirm({
  label,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const promptId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !disabled) {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs"
    >
      <span id={promptId} className="mr-auto text-red-700">
        {label}
      </span>
      <button
        type="button"
        aria-describedby={promptId}
        disabled={disabled}
        onClick={onConfirm}
        className={`inline-flex min-h-6 items-center rounded px-1 font-semibold text-red-600 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50 ${focusRing}`}
      >
        {confirmLabel}
      </button>
      <button
        ref={cancelRef}
        type="button"
        disabled={disabled}
        onClick={onCancel}
        className={`inline-flex min-h-6 items-center rounded px-1 text-neutral-600 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
      >
        {cancelLabel}
      </button>
    </div>
  );
}
