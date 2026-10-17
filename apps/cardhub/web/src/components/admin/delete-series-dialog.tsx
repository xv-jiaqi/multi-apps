import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { t, type Locale } from '@repo/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ConfirmPhraseField,
  isConfirmPhraseValid,
} from '@repo/ui-web';
import { useStores } from '../../stores/root-store';
import { failureText, formatAdminCount, isAccessRevoked } from './catalog-utils';

function PhraseLabel({ locale, slug }: { locale: Locale; slug: string }) {
  const label = t(locale, 'admin.series.forceConfirmLabel', { slug });
  const index = label.indexOf(slug);
  if (index < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, index)}
      <code className="font-mono">{slug}</code>
      {label.slice(index + slug.length)}
    </>
  );
}

export const DeleteSeriesDialog = observer(function DeleteSeriesDialog({
  series,
  onOpenChange,
  onConfirm,
  onForbidden,
  onCloseAutoFocus,
}: {
  series: { slug: string; title: string; cardCount: number; commentCount: number } | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  onForbidden: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = series !== null;
  const canConfirm = series ? isConfirmPhraseValid(phrase, series.slug) : false;

  useEffect(() => {
    if (!open) {
      setPhrase('');
      setError(null);
      setBusy(false);
    }
  }, [open, series?.slug]);

  const confirm = async () => {
    if (!series || busy || !canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      if (isAccessRevoked(caught)) {
        onForbidden();
        onOpenChange(false);
        return;
      }
      setError(failureText(locale.locale, caught, 'admin.deleteFailed'));
      setBusy(false);
      actionRef.current?.focus();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent
        size="md"
        variant="destructive"
        busy={busy}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {series ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {series.cardCount === 0
                  ? tt('admin.series.forceTitleSeriesComments', { title: series.title })
                  : tt('admin.series.forceTitle', { title: series.title })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {series.cardCount === 0
                  ? tt('admin.series.forceBodySeriesComments', {
                      comments: formatAdminCount(
                        locale.locale,
                        'seriesComments',
                        series.commentCount,
                      ),
                    })
                  : tt('admin.series.forceBody', {
                      cards: formatAdminCount(locale.locale, 'cards', series.cardCount),
                      comments: formatAdminCount(locale.locale, 'comments', series.commentCount),
                    })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-4 space-y-4 text-sm text-neutral-800">
              <ConfirmPhraseField
                ref={inputRef}
                id="delete-series-phrase"
                label={<PhraseLabel locale={locale.locale} slug={series.slug} />}
                value={phrase}
                onValueChange={setPhrase}
              />
            </div>
            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  {tt('admin.cancel')}
                </Button>
              </AlertDialogCancel>
              <Button
                ref={actionRef}
                type="button"
                variant="destructive"
                disabled={busy || !canConfirm}
                aria-busy={busy || undefined}
                onClick={() => void confirm()}
              >
                {busy ? tt('admin.deleting') : tt('admin.series.forceConfirm')}
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <AlertDialogDescription>
            {tt('admin.series.forceTitle', { title: '' })}
          </AlertDialogDescription>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
});
