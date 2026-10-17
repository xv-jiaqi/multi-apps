import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { t } from '@repo/shared';
import { Button, Input } from '@repo/ui-web';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui-web';
import { useStores } from '../../stores/root-store';
import { createAttributeRow, type AttributeRow, type AttributeType } from './catalog-utils';

export const AttributesEditor = observer(function AttributesEditor({
  rows,
  onChange,
  errors,
}: {
  rows: AttributeRow[];
  onChange: (rows: AttributeRow[]) => void;
  errors: Record<string, string>;
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const keyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const addRef = useRef<HTMLButtonElement>(null);
  const [pendingFocus, setPendingFocus] = useState<string | 'add' | null>(null);

  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus === 'add') addRef.current?.focus();
    else keyRefs.current[pendingFocus]?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const addRow = () => {
    const row = createAttributeRow();
    onChange([...rows, row]);
    setPendingFocus(row.id);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange(next);
    const focusId = next[index]?.id ?? next[index - 1]?.id;
    setPendingFocus(focusId ?? 'add');
  };

  const updateRow = (index: number, patch: Partial<AttributeRow>) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key !== 'Enter') return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.attrKey === undefined && target.dataset.attrValue === undefined) return;
    event.preventDefault();
    const index = Number(target.closest('[data-row-index]')?.getAttribute('data-row-index'));
    if (!Number.isInteger(index)) return;
    if (index === rows.length - 1) {
      addRow();
      return;
    }
    const next = rows[index + 1];
    if (next) setPendingFocus(next.id);
  };

  return (
    <fieldset className="space-y-2" onKeyDown={onEditorKeyDown}>
      <legend className="text-sm font-medium text-neutral-800">{tt('admin.attrs.label')}</legend>
      <div aria-hidden className="hidden gap-2 px-0.5 text-xs text-neutral-600 sm:flex">
        <span className="w-40">{tt('admin.attrs.colKey')}</span>
        <span className="w-28">{tt('admin.attrs.colType')}</span>
        <span className="flex-1">{tt('admin.attrs.colValue')}</span>
        <span className="w-10" />
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-600">{tt('admin.attrs.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => {
            const n = index + 1;
            const rowError = errors[row.id];
            return (
              <li key={row.id} data-row-index={index} className="flex flex-wrap items-start gap-2">
                <Input
                  size="sm"
                  className="w-full sm:w-40"
                  value={row.key}
                  aria-label={tt('admin.attrs.keyAria', { n })}
                  data-attr-key={row.id}
                  ref={(node) => {
                    keyRefs.current[row.id] = node;
                  }}
                  onChange={(event) => updateRow(index, { key: event.target.value })}
                />
                <Select
                  value={row.type}
                  onValueChange={(value) => {
                    const type = value as AttributeType;
                    updateRow(index, {
                      type,
                      value: type === 'boolean' ? 'true' : row.type === 'boolean' ? '' : row.value,
                    });
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-28"
                    aria-label={tt('admin.attrs.typeAria', { n })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">{tt('admin.attrs.typeText')}</SelectItem>
                    <SelectItem value="number">{tt('admin.attrs.typeNumber')}</SelectItem>
                    <SelectItem value="boolean">{tt('admin.attrs.typeBool')}</SelectItem>
                  </SelectContent>
                </Select>
                {row.type === 'boolean' ? (
                  <Select
                    value={row.value === 'false' ? 'false' : 'true'}
                    onValueChange={(value) => updateRow(index, { value })}
                  >
                    <SelectTrigger
                      size="sm"
                      className="min-w-0 flex-1"
                      aria-label={tt('admin.attrs.valueAria', { n })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">{tt('admin.attrs.true')}</SelectItem>
                      <SelectItem value="false">{tt('admin.attrs.false')}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    size="sm"
                    inputMode={row.type === 'number' ? 'decimal' : 'text'}
                    className="min-w-0 flex-1"
                    value={row.value}
                    aria-label={tt('admin.attrs.valueAria', { n })}
                    data-attr-value={row.id}
                    onChange={(event) => updateRow(index, { value: event.target.value })}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  aria-label={
                    row.key.trim()
                      ? tt('admin.attrs.remove', { key: row.key.trim() })
                      : tt('admin.attrs.removeRow', { n })
                  }
                  onClick={() => removeRow(index)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
                {rowError ? <p className="w-full text-xs text-red-700">{rowError}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      <Button ref={addRef} type="button" variant="outline" size="sm" onClick={addRow}>
        {tt('admin.attrs.add')}
      </Button>
    </fieldset>
  );
});
