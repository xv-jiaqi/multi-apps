export function SectionSkeleton({ withThumb }: { withThumb?: boolean }) {
  return (
    <ul className="divide-y divide-neutral-200/70">
      {Array.from({ length: 3 }).map((_, index) => (
        <li
          key={index}
          className={`grid animate-pulse motion-reduce:animate-none gap-3 py-3 first:pt-0 last:pb-0 ${
            withThumb ? 'grid-cols-[auto_minmax(0,1fr)]' : ''
          }`}
        >
          {withThumb ? <div className="aspect-[63/88] w-10 rounded-sm bg-neutral-200" /> : null}
          <div className="min-w-0 space-y-2">
            <div className="h-4 w-3/4 rounded bg-neutral-200" />
            <div className="h-3 w-1/2 rounded bg-neutral-200" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ToggleSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-10 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none"
    />
  );
}
