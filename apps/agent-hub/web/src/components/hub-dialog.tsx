import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogContentSize,
} from '@repo/ui-web';
import { errorMessage } from '../api/client';
import { useBotOcclusion } from '../desktop/hooks';
import { toast } from '../lib/toast';

let noticeSeq = 1;

export function HubDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: DialogContentSize;
  footer?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  useBotOcclusion(props.open);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size={props.size} closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription className={props.description ? undefined : 'sr-only'}>
            {props.description ?? props.title}
          </DialogDescription>
        </DialogHeader>
        {props.children}
        {props.footer ? <DialogFooter>{props.footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

export function HubAlertDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  useBotOcclusion(props.open);

  useEffect(() => {
    if (!props.open) {
      setPending(false);
      setError(null);
    }
  }, [props.open]);

  function requestClose(): void {
    if (pending) return;
    props.onOpenChange(false);
  }

  async function confirm(): Promise<void> {
    const result = props.onConfirm();
    if (!(result instanceof Promise)) {
      props.onOpenChange(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await result;
      setPending(false);
      props.onOpenChange(false);
    } catch (caught) {
      setPending(false);
      const text = errorMessage(caught);
      setError({ id: noticeSeq, text });
      noticeSeq += 1;
      toast.error(text);
    }
  }

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : requestClose())}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p key={error.id} role="alert" className="select-text mt-3 text-sm text-red-700">
            {error.text}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button
            type="button"
            variant={props.destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? '处理中…' : props.confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
