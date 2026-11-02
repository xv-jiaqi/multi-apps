import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

type Naming =
  /** id of the visible heading or caption above the region (CH-220 §2-1). */
  | { labelledBy: string; label?: never }
  /** Fallback name, only when there is no visible heading (CH-220 §2-2). */
  | { label: string; labelledBy?: never };

export type ScrollRegionProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'tabIndex' | 'role' | 'aria-label' | 'aria-labelledby'
> &
  Naming & {
    /** Draw the focus ring inside the box when an ancestor would clip it (CH-220 §3-2). */
    inset?: boolean;
  };

/**
 * Horizontal scroller that keyboard users can focus and scroll (WCAG 2.1.1,
 * axe scrollable-region-focusable). Always focusable, whether or not the
 * content overflows (CH-220 §4-1).
 */
export const ScrollRegion = forwardRef<HTMLDivElement, ScrollRegionProps>(function ScrollRegion(
  { labelledBy, label, inset = false, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      {...props}
      tabIndex={0}
      role="region"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn(
        'overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        inset
          ? 'focus-visible:ring-inset focus-visible:ring-offset-0'
          : 'focus-visible:ring-offset-2',
        className,
      )}
    />
  );
});
