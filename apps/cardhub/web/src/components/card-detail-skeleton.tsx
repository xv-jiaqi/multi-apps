import { PageShell } from './page-shell';

/**
 * Matches the card detail frame: breadcrumb line, 63:88 art, and the
 * text-3xl / text-base / text-sm stack beside it. Used before the route
 * chunk arrives and while `cards.bySlug` is in flight.
 */
export function CardDetailSkeleton() {
  return (
    <PageShell>
      <div className="space-y-8" aria-busy="true">
        <div className="h-5 w-64 max-w-full animate-pulse rounded bg-neutral-200" />
        <div className="grid gap-8 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="aspect-[63/88] animate-pulse rounded-3xl border border-white/60 bg-neutral-200 shadow-xl" />
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-40 animate-pulse rounded bg-neutral-200" />
                <div className="h-5 w-14 animate-pulse rounded-full bg-neutral-200" />
              </div>
              <div className="h-6 w-full animate-pulse rounded bg-neutral-200" />
              <div className="h-5 w-48 max-w-full animate-pulse rounded bg-neutral-200" />
            </div>
            <div className="h-36 animate-pulse rounded-xl border border-white/60 bg-white/70" />
            <div className="h-28 animate-pulse rounded-xl border border-white/60 bg-white/70" />
            <div className="h-40 animate-pulse rounded-xl border border-white/60 bg-white/70" />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
