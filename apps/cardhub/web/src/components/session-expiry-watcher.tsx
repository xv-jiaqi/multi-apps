import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { subscribeSessionExpired } from '../lib/session-expiry';
import { applySessionExpiry } from '../lib/session-expiry-redirect';

export function SessionExpiryWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    return subscribeSessionExpired((error) => {
      const current = locationRef.current;
      applySessionExpiry({
        pathname: current.pathname,
        search: current.search,
        hash: current.hash,
        navigate,
        error,
      });
    });
  }, [navigate]);

  return null;
}
