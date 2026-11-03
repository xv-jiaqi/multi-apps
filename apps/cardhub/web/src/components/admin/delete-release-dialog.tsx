import { useRef } from 'react';
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

export function DeleteReleaseDialog({
  release,
  busy,
  error,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: {
  release: { id: string; title: string } | null;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = release !== null;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent
        size="sm"
        variant="destructive"
        busy={busy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{tt('admin.releases.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {release ? tt('admin.releases.deleteBody', { title: release.title }) : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button ref={cancelRef} type="button" variant="outline" disabled={busy}>
              {tt('admin.cancel')}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            onClick={() => {
              if (busy) return;
              onConfirm();
            }}
          >
            {busy ? tt('admin.deleting') : tt('admin.action.delete')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
