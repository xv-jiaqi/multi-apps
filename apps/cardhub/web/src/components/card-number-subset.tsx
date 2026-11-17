import { cn } from '@repo/ui-web';
import { displayCardNumber } from '../lib/catalog-taxonomy';

/**
 * CH-241 §2: «#025 · 收录卡» under a search hit's name. The subset falls back
 * to its slug when it has no name. A missing number shows only the subset;
 * nothing renders when both are missing.
 */
export function CardNumberSubsetLine({
  cardNumber,
  subsetName,
  subsetSlug,
  className,
}: {
  cardNumber: string | null | undefined;
  subsetName: string | null | undefined;
  subsetSlug: string | null | undefined;
  className?: string;
}) {
  const number = cardNumber?.trim() ? displayCardNumber(cardNumber.trim()) : null;
  const subset = subsetName?.trim() || subsetSlug?.trim() || null;
  if (!number && !subset) return null;
  return (
    <span
      className={cn(
        'block font-mono text-xs tabular-nums text-neutral-600 wrap-anywhere',
        className,
      )}
    >
      {[number, subset].filter((part) => part !== null).join(' · ')}
    </span>
  );
}
