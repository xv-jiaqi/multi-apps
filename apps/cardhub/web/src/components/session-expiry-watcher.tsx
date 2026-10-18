import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { clearActiveQueryClient } from '../lib/trpc';
import { subscribeSessionExpired } from '../lib/session-expiry';
import { rootStore } from '../stores/root-store';

const STAY_PUT = new Set(['/login', '/register']);

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
      if (STAY_PUT.has(current.pathname)) return;
      navigate('/login', { replace: true, state: { from, notice: 'sessionExpired' } });
    });
  }, [navigate]);

  return null;
}
