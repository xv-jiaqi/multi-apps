import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  useBlocker,
  useLocation,
  useNavigate,
  type BlockerFunction,
  type Location,
} from 'react-router';
import { t } from '@repo/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@repo/ui-web';
import { useStores } from '../../stores/root-store';

export interface AttributeSnapshot {
  key: string;
  type: string;
  value: string;
}

/** Compare attribute rows by type, key, and value. Generated row ids are not edits. */
export function sameAttributeRows(
  current: AttributeSnapshot[],
  baseline: AttributeSnapshot[],
): boolean {
  if (current.length !== baseline.length) return false;
  return current.every((row, index) => {
    const other = baseline[index];
    return row.key === other?.key && row.type === other?.type && row.value === other?.value;
  });
}

export function attributeSnapshots(
  rows: { key: string; type: string; value: string }[],
): AttributeSnapshot[] {
  return rows.map((row) => ({ key: row.key, type: row.type, value: row.value }));
}

function isSamePlace(current: Location, next: Location) {
  return (
    current.pathname === next.pathname &&
    current.search === next.search &&
    current.hash === next.hash
  );
}

/**
 * Block in-app navigations while `dirty` is true and ask with the shared
 * AlertDialog. Closing or reloading the tab uses the browser's beforeunload
 * prompt, and only while there is something unsaved.
 */
export function useUnsavedChanges(dirty: boolean): {
  allowLeave: () => void;
  dialog: ReactNode;
} {
  const { locale, session } = useStores();
  const location = useLocation();
  const tt = (key: string) => t(locale.locale, key);
  const dirtyRef = useRef(dirty);
  const bypassRef = useRef(false);
  const leavingRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sawBlockedRef = useRef(false);
  const accessRef = useRef({ authed: session.isAuthenticated, admin: session.isAdmin });
  const forcedRef = useRef(false);
  dirtyRef.current = dirty;

  // Losing the session or the admin role makes saving impossible. Latch it so
  // a system redirect in the same commit is not asked to confirm.
  const lostAccess =
    (accessRef.current.authed && !session.isAuthenticated) ||
    (accessRef.current.admin && !session.isAdmin);
  if (session.isAuthenticated && session.isAdmin) {
    forcedRef.current = false;
  } else if (lostAccess) {
    forcedRef.current = true;
  }
  accessRef.current = { authed: session.isAuthenticated, admin: session.isAdmin };

  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (forcedRef.current || bypassRef.current || !dirtyRef.current) return false;
    return !isSamePlace(currentLocation, nextLocation);
  }, []);
  const blocker = useBlocker(shouldBlock);

  if (blocker.state === 'blocked') {
    if (!sawBlockedRef.current) {
      const active = document.activeElement;
      triggerRef.current = active instanceof HTMLElement ? active : null;
      sawBlockedRef.current = true;
      leavingRef.current = false;
    }
  } else {
    sawBlockedRef.current = false;
  }

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older Safari still shows the prompt only when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // allowLeave() is one navigation wide. Clear it once that navigation lands
  // so a later edit (including "save and create the next one") asks again.
  useEffect(() => {
    bypassRef.current = false;
  }, [location.key]);

  const allowLeave = useCallback(() => {
    bypassRef.current = true;
  }, []);

  const stay = () => {
    if (blocker.state === 'blocked') blocker.reset();
  };

  const discard = () => {
    if (blocker.state !== 'blocked') return;
    leavingRef.current = true;
    blocker.proceed();
  };

  const dialog = (
    <AlertDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (open || leavingRef.current || blocker.state !== 'blocked') return;
        blocker.reset();
      }}
    >
      <AlertDialogContent
        size="sm"
        variant="default"
        onCloseAutoFocus={(event) => {
          const trigger = triggerRef.current;
          triggerRef.current = null;
          if (blocker.state !== 'unblocked' || !trigger?.isConnected) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          trigger.focus({ preventScroll: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{tt('admin.unsaved.title')}</AlertDialogTitle>
          <AlertDialogDescription>{tt('admin.unsaved.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" onClick={stay}>
              {tt('admin.unsaved.stay')}
            </Button>
          </AlertDialogCancel>
          {/* A plain button: AlertDialogAction would close and reset before proceed. */}
          <Button type="button" onClick={discard}>
            {tt('admin.unsaved.discard')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { allowLeave, dialog };
}

/**
 * Session expiry while an admin form is open. Anonymous visitors who land
 * here still see the in-page login link; only a session that disappears
 * mid-edit is sent to /login. The unsaved guard lets this redirect through.
 */
export function useRedirectOnSessionExpiry() {
  const { session } = useStores();
  const navigate = useNavigate();
  const location = useLocation();
  const hadSession = useRef(session.isAuthenticated);
  if (session.isAuthenticated) hadSession.current = true;

  useEffect(() => {
    if (!hadSession.current || session.isAuthenticated) return;
    navigate('/login', {
      replace: true,
      state: { from: `${location.pathname}${location.search}${location.hash}` },
    });
  }, [session.isAuthenticated, navigate, location.pathname, location.search, location.hash]);
}
