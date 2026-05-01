import type { PropsWithChildren } from 'react';
import { SiteHeader } from './site-header';

export function PageShell({ children }: PropsWithChildren) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-white via-neutral-50 to-neutral-100 text-neutral-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(165,180,252,0.4),rgba(255,255,255,0))]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-40 h-96 w-96 rounded-full bg-rose-200/50 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-80 h-96 w-96 rounded-full bg-sky-200/50 blur-3xl"
      />
      <SiteHeader />
      <main className="relative mx-auto w-full max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
