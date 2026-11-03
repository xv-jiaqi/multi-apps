import { PageShell } from './page-shell';

const block = 'animate-pulse motion-reduce:animate-none bg-neutral-200';

/**
 * Matches the CH-206 card detail frame: breadcrumb line, a 2 / 3 split at
 * lg (two columns at md, one below), 63:88 art, the title stack, and white
 * panels on the page background. Used before the route chunk arrives and
 * while `cards.bySlug` is in flight.
 */
export function CardDetailSkeleton() {
  return (
    <PageShell>
      <div className="space-y-8" aria-busy="true">
        <div className={`h-5 w-64 max-w-full rounded ${block}`} />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="mx-auto w-full max-w-sm md:max-w-none lg:col-span-2">
            <div className={`aspect-[63/88] rounded-3xl ring-1 ring-black/5 ${block}`} />
          </div>
          <div className="min-w-0 space-y-6 lg:col-span-3">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`h-8 w-40 rounded sm:h-9 ${block}`} />
                <div className={`h-5 w-14 rounded-full ${block}`} />
              </div>
              <div className={`h-5 w-48 max-w-full rounded ${block}`} />
              <div className={`h-5 w-32 max-w-full rounded ${block}`} />
            </div>
            <div className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-card motion-reduce:animate-none" />
            <div className="space-y-3">
              <div className={`h-6 w-20 rounded ${block}`} />
              <div className={`h-4 w-full rounded ${block}`} />
              <div className={`h-4 w-full rounded ${block}`} />
              <div className={`h-4 w-2/3 rounded ${block}`} />
            </div>
            <div className="h-40 animate-pulse rounded-xl border border-neutral-200 bg-card motion-reduce:animate-none" />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
