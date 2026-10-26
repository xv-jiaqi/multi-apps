import { useId } from 'react';
import { controlBase, Input } from '@repo/ui-web';
import { DELETE_REASON_MAX, t, type Locale } from '@repo/shared';

export function DeleteReasonField({
  locale,
  value,
  onChange,
  readOnly,
}: {
  locale: Locale;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const fieldId = useId();
  const countId = `${fieldId}-count`;
  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={fieldId} className="text-xs font-medium text-red-800">
        {t(locale, 'admin.deleteReason.label')}
      </label>
      <Input
        id={fieldId}
        size="sm"
        maxLength={DELETE_REASON_MAX}
        value={value}
        readOnly={readOnly}
        aria-describedby={countId}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={countId} className="text-xs text-neutral-700" aria-live="off">
        {t(locale, 'admin.deleteReason.count', { n: value.length })}
      </span>
    </div>
  );
}

export function DeleteReasonTextarea({
  locale,
  value,
  onChange,
  readOnly,
}: {
  locale: Locale;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const fieldId = useId();
  const countId = `${fieldId}-count`;
  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-neutral-800">
        {t(locale, 'admin.deleteReason.label')}
      </label>
      <textarea
        id={fieldId}
        rows={3}
        maxLength={DELETE_REASON_MAX}
        value={value}
        readOnly={readOnly}
        aria-describedby={countId}
        onChange={(event) => onChange(event.target.value)}
        className={`${controlBase} h-auto py-2`}
      />
      <div className="flex justify-end gap-3 text-xs text-neutral-600">
        <span id={countId} aria-live="off">
          {t(locale, 'admin.deleteReason.count', { n: value.length })}
        </span>
      </div>
    </div>
  );
}
