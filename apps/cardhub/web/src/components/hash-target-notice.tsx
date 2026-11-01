interface HashTargetNoticeProps {
  message: string;
  actionHref?: string;
  actionLabel?: string;
}

/**
 * Always mounted so a later message is announced. Empty text stays silent.
 * The optional action is the same “see all comments” link on cards and topics.
 */
export function HashTargetNotice({ message, actionHref, actionLabel }: HashTargetNoticeProps) {
  const visible = message !== '';
  const showAction = visible && Boolean(actionHref) && Boolean(actionLabel);
  return (
    <p role="status" className={visible ? 'text-sm text-neutral-600' : 'sr-only'}>
      {message}
      {showAction ? (
        <>
          {' '}
          <a
            href={actionHref}
            className="inline-flex min-h-6 items-center rounded px-1 font-medium text-brand-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {actionLabel}
          </a>
        </>
      ) : null}
    </p>
  );
}
