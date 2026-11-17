import type { Locale } from '@repo/shared';
import { cn } from '@repo/ui-web';
import { rarityCodeLabel } from '../lib/rarity-code-label';

/**
 * Spec CH-239 §3: visible code plus its spoken name. When they differ the
 * symbol is hidden from screen readers and the name is read instead.
 */
export function RarityCodeText({ locale, code }: { locale: Locale; code: string }) {
  const label = rarityCodeLabel(locale, code);
  if (label.visible === label.spoken) return <>{label.visible}</>;
  return (
    <>
      <span aria-hidden="true">{label.visible}</span>
      <span className="sr-only">{label.spoken}</span>
    </>
  );
}

/**
 * Spec CH-239 §4 / §4-1: neutral official-code badge, same look as
 * `CardVariantBadge`. Not clickable, one colour for every code.
 */
export function RarityCodeBadge({
  locale,
  code,
  className,
}: {
  locale: Locale;
  code: string;
  className?: string;
}) {
  const label = rarityCodeLabel(locale, code);
  return (
    <span
      title={label.visible}
      className={cn(
        'inline-flex max-w-24 shrink-0 items-center truncate rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600',
        className,
      )}
    >
      <span className="min-w-0 truncate">
        <RarityCodeText locale={locale} code={code} />
      </span>
    </span>
  );
}
