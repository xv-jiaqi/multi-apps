import { useSyncExternalStore, type ReactElement } from 'react';
import { toast } from '../lib/toast';
import { focusRing } from '../lib/format';

export function Toaster(): ReactElement {
  const items = useSyncExternalStore(toast.subscribe, toast.getSnapshot, toast.getSnapshot);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === 'error' ? 'alert' : 'status'}
          className={
            item.tone === 'error'
              ? 'pointer-events-auto flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900'
              : 'pointer-events-auto flex items-start gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-md'
          }
        >
          <p className="select-text min-w-0 flex-1">{item.text}</p>
          <button
            type="button"
            className={`inline-flex h-8 shrink-0 items-center rounded-md px-2 text-neutral-700 ${focusRing}`}
            onClick={() => toast.dismiss(item.id)}
          >
            关闭
          </button>
        </div>
      ))}
    </div>
  );
}
