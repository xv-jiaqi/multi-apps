import type { MouseEvent } from 'react';
import { reducedMotion } from '../lib/hash-target';

interface HashTargetNoticeProps {
  message: string;
  actionHref?: string;
  actionLabel?: string;
}

/**
 * Always mounted so a later message is announced. Empty text stays silent.
 * The action names the on-page heading and moves focus there. A hash change
 * alone does not count.
 */
export function HashTargetNotice({ message, actionHref, actionLabel }: HashTargetNoticeProps) {
  const visible = message !== '';
  const showAction = visible && Boolean(actionHref) && Boolean(actionLabel);

  const moveFocus = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!actionHref?.startsWith('#')) return;
    const title = document.getElementById(actionHref.slice(1));
    if (!(title instanceof HTMLElement)) return;
    event.preventDefault();
    title.scrollIntoView?.({
      block: 'start',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    title.focus({ preventScroll: true });
  };

  return (
    <p role="status" className={visible ? 'text-sm text-neutral-600' : 'sr-only'}>
      {message}
      {showAction ? (
        <>
          {' '}
          <a
            href={actionHref}
            onClick={moveFocus}
            className="inline-flex min-h-6 items-center rounded px-1 font-medium text-brand-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {actionLabel}
          </a>
        </>
      ) : null}
    </p>
  );
}
