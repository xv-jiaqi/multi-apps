import { discardAllForumDrafts } from './forum-draft';
import { clearNotificationCache } from './notification-cache';
import { clearActiveQueryClient } from './trpc';
import { SESSION_KEY, rootStore } from '../stores/root-store';

/**
 * When another tab signs out, drop this tab's session and cached queries so
 * listings contact (and other signed-in data) cannot linger here.
 * The `storage` event only fires in other tabs, not the one that wrote.
 */
export function listenForCrossTabSessionChanges(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_KEY) return;
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    if (event.newValue !== null) return;
    if (!rootStore.session.isAuthenticated) return;

    clearNotificationCache();
    discardAllForumDrafts();
    rootStore.session.signOut();
    clearActiveQueryClient();
  };

  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
