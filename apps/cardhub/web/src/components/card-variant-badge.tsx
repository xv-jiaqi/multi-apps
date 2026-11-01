import type { ReactNode } from 'react';
import { printRunLabel, t, type Locale } from '@repo/shared';

const badgeClass =
  'inline-flex max-w-full min-w-0 truncate rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600';

export function CardVariantBadge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className={badgeClass}>
      {children}
    </span>
  );
}

function LimitedRun({ locale, printRun }: { locale: Locale; printRun: number }) {
  const label = printRunLabel(locale, printRun);
  const slash = label.lastIndexOf('/');
  if (slash < 0) return label;
  return (
    <>
      {label.slice(0, slash)}
      <span className="font-mono tabular-nums">{label.slice(slash)}</span>
    </>
  );
}

/** Series and search tiles. Unnumbered cards render nothing here. */
export function CardVariantBadgeRow({
  locale,
  parallelName,
  printRun,
  isParallel,
  className,
}: {
  locale: Locale;
  parallelName?: string | null;
  printRun?: number | null;
  isParallel?: boolean;
  className?: string;
}) {
  const name = parallelName?.trim() ?? '';
  const showParallel = Boolean(isParallel && name);
  const showRun = typeof printRun === 'number';
  if (!showParallel && !showRun) return null;
  return (
    <div className={className ?? 'flex min-w-0 flex-wrap gap-1'}>
      {showParallel ? (
        <CardVariantBadge title={name}>
          {t(locale, 'card.variant.parallel', { name })}
        </CardVariantBadge>
      ) : null}
      {showRun ? (
        <CardVariantBadge>
          <LimitedRun locale={locale} printRun={printRun} />
        </CardVariantBadge>
      ) : null}
    </div>
  );
}
