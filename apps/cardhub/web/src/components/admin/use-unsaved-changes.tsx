import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useBlocker, type BlockerFunction, type Location } from 'react-router';
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
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const dirtyRef = useRef(dirty);
  const bypassRef = useRef(false);
  const leavingRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sawBlockedRef = useRef(false);
  dirtyRef.current = dirty;

  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (bypassRef.current || !dirtyRef.current) return false;
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
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

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
