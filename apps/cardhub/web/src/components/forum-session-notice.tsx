import type { Ref } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useLocation } from 'react-router';
import { t } from '@repo/shared';
import { resolvePostAuthRedirect } from '../lib/auth-redirect';
import { useForumSessionNoticeShown } from '../lib/forum-session-notice';
import { useStores } from '../stores/root-store';

/**
 * CH-226 §6-3: always mounted so the text is announced when it appears.
 * Empty means hidden and takes no space. `tabIndex={-1}` only serves §6-6
 * (focus lands here when the reply form it replaced held focus).
 */
export const ForumSessionNotice = observer(function ForumSessionNotice({
  ref,
}: {
  ref?: Ref<HTMLParagraphElement>;
}) {
  const { locale } = useStores();
  const { pathname, search, hash } = useLocation();
  const shown = useForumSessionNoticeShown({ pathname });
  const from = resolvePostAuthRedirect(`${pathname}${search}${hash}`, '/forum');

  return (
    <p
      ref={ref}
      role="status"
      tabIndex={-1}
      className={
        shown
          ? 'scroll-mt-20 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
          : 'sr-only'
      }
    >
      {shown ? (
        <>
          {t(locale.locale, 'auth.notice.sessionExpired')}{' '}
          <Link
            to="/login"
            state={{ from }}
            className="inline-flex min-h-6 items-center rounded px-1 font-medium text-link-strong underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 scroll-mt-20"
          >
            {t(locale.locale, 'auth.actions.login')}
          </Link>
        </>
      ) : null}
    </p>
  );
});

/** True while §6 shows the notice on this page (used to swap out the reply prompt). */
export function useForumSessionNoticeHere(): boolean {
  const { pathname } = useLocation();
  return useForumSessionNoticeShown({ pathname });
}
