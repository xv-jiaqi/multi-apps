import { useEffect, useRef } from 'react';
import { reaction } from 'mobx';
import { useLocation, useNavigate } from 'react-router';
import { subscribeSessionExpired } from '../lib/session-expiry';
import { applySessionExpiry, settleSessionExpiryNavigation } from '../lib/session-expiry-redirect';
import { hideForumSessionNotice, hideForumSessionNoticeOffPath } from '../lib/forum-session-notice';
import { rootStore } from '../stores/root-store';

export function SessionExpiryWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    return subscribeSessionExpired((_error, origin) => {
      const current = locationRef.current;
      applySessionExpiry({
        pathname: current.pathname,
        search: current.search,
        hash: current.hash,
        navigate,
        origin,
      });
    });
  }, [navigate]);

  // CH-226 §6-7: the forum notice ends with a new pathname or a new sign-in.
  useEffect(() => {
    settleSessionExpiryNavigation();
    hideForumSessionNoticeOffPath({ pathname: location.pathname });
  }, [location.pathname]);

  useEffect(
    () =>
      reaction(
        () => rootStore.session.token,
        (token) => {
          if (token) hideForumSessionNotice();
        },
      ),
    [],
  );

  return null;
}
