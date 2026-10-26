import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { Button } from '@repo/ui-web';
import { useStores } from '../stores/root-store';

export const LEGACY_PASSWORD_LATER_KEY = 'cardhub:legacyPasswordLater';

function readLaterDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(LEGACY_PASSWORD_LATER_KEY) === '1';
  } catch {
    return false;
  }
}

export const LegacyPasswordNotice = observer(function LegacyPasswordNotice() {
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const recommended = session.user?.passwordChangeRecommended === true;
  const [dismissed, setDismissed] = useState(readLaterDismissed);

  useEffect(() => {
    if (!recommended) setDismissed(readLaterDismissed());
  }, [recommended]);

  if (!recommended || dismissed) return null;

  const later = () => {
    try {
      window.sessionStorage.setItem(LEGACY_PASSWORD_LATER_KEY, '1');
    } catch {
      // sessionStorage may be unavailable; still hide for this view.
    }
    setDismissed(true);
    document.getElementById('main')?.focus();
  };

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{tt('auth.legacyPassword.notice')}</p>
      <div className="flex shrink-0 items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link to="/me/password">{tt('auth.legacyPassword.action')}</Link>
        </Button>
        <button
          type="button"
          onClick={later}
          className="inline-flex min-h-6 items-center rounded px-1 text-sm font-medium text-amber-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {tt('auth.legacyPassword.later')}
        </button>
      </div>
    </div>
  );
});
