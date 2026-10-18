import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { clearActiveQueryClient } from '../lib/trpc';
import { subscribeSessionExpired } from '../lib/session-expiry';
import { rootStore } from '../stores/root-store';

function pageRequiresLogin(pathname: string): boolean {
  if (pathname === '/me' || pathname.startsWith('/me/')) return true;
  if (pathname === '/forum/new') return true;
  if (/^\/forum\/[^/]+\/edit$/.test(pathname)) return true;
  if (pathname === '/trade/new') return true;
  if (pathname === '/reports' || pathname.startsWith('/reports/')) return true;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true;
  return false;
}

export function SessionExpiryWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const handled = useRef(false);
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    handled.current = false;
  }, [location.pathname]);

  useEffect(() => {
    return subscribeSessionExpired(() => {
      if (handled.current) return;
      handled.current = true;
      const current = locationRef.current;
      const from = `${current.pathname}${current.search}${current.hash}`;
      rootStore.session.signOut();
      clearActiveQueryClient();
      if (!pageRequiresLogin(current.pathname)) return;
      navigate('/login', { replace: true, state: { from, notice: 'sessionExpired' } });
    });
  }, [navigate]);

  return null;
}
