import type { ReactNode } from 'react';

/** Persistent explanation that replaces a blocked composer. Not an alert. */
export function BannedNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
      {children}
    </p>
  );
}
