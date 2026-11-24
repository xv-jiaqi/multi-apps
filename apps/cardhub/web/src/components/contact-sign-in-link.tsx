import { Link } from 'react-router';
import { t } from '@repo/shared';
import { useStores } from '../stores/root-store';

/** Spec CH-250 §2-3: comment-section login prompt plus a 24px target. */
export const CONTACT_SIGN_IN_LINK_CLASS =
  'inline-flex min-h-6 items-center rounded font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export function ContactSignInLink({ from }: { from: string }) {
  const { locale } = useStores();
  return (
    <Link to="/login" state={{ from }} className={CONTACT_SIGN_IN_LINK_CLASS}>
      {t(locale.locale, 'trade.list.contactSignIn')}
    </Link>
  );
}
