import { observer } from 'mobx-react-lite';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { t } from '@repo/shared';
import { useStores } from '../../stores/root-store';

const AdminAccessContext = createContext<(() => void) | null>(null);

export function useReportForbidden(): () => void {
  const report = useContext(AdminAccessContext);
  return report ?? (() => undefined);
}

export const AdminGate = observer(function AdminGate({ children }: { children: ReactNode }) {
  const { locale, session } = useStores();
  const location = useLocation();
  const tt = (key: string) => t(locale.locale, key);
  const [revoked, setRevoked] = useState(false);
  const reportForbidden = useCallback(() => setRevoked(true), []);

  if (!session.isAuthenticated) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
        <Link
          to="/login"
          state={{ from: location.pathname }}
          className="text-brand-600 hover:underline"
        >
          {tt('admin.loginRequired')}
        </Link>
      </p>
    );
  }

  if (!session.isAdmin || revoked) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
        {tt('admin.adminOnly')}
      </p>
    );
  }

  return (
    <AdminAccessContext.Provider value={reportForbidden}>{children}</AdminAccessContext.Provider>
  );
});
