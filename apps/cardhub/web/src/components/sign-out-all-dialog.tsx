import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { observer } from 'mobx-react-lite';
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
import { APP_ERROR_CODES, t } from '@repo/shared';
import { clearActiveQueryClient, trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

export const SignOutAllDialog = observer(function SignOutAllDialog() {
  const navigate = useNavigate();
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mutation = trpc.auth.signOutAll.useMutation();
  const busy = mutation.isPending;

  const onConfirm = () => {
    setFormError(null);
    mutation.mutate(undefined, {
      onSuccess() {
        session.signOut();
        clearActiveQueryClient();
        setOpen(false);
        navigate('/login', { replace: true, state: { notice: 'signedOutAll' } });
      },
      onError(error) {
        const data = error.data;
        if (data?.code === 'UNAUTHORIZED' && data.appCode !== APP_ERROR_CODES.WRONG_PASSWORD) {
          return;
        }
        setFormError(tt('me.signOutAll.failed'));
        confirmRef.current?.focus();
      },
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setFormError(null);
      }}
    >
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {tt('me.signOutAll.button')}
      </Button>
      <AlertDialogContent
        variant="destructive"
        size="sm"
        busy={busy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{tt('me.signOutAll.title')}</AlertDialogTitle>
          <AlertDialogDescription>{tt('me.signOutAll.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        {formError ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formError}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button ref={cancelRef} type="button" variant="outline" disabled={busy}>
              {tt('me.signOutAll.cancel')}
            </Button>
          </AlertDialogCancel>
          <Button
            ref={confirmRef}
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            {tt('me.signOutAll.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});
