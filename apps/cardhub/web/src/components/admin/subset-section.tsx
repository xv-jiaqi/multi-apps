import { observer } from 'mobx-react-lite';
import { useRef, useState, type FormEvent } from 'react';
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
  Input,
  SegmentedControl,
} from '@repo/ui-web';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';
import { AdminField } from './admin-field';
import {
  failureText,
  isAccessRevoked,
  readTrpcFailure,
  validateRequiredText,
  validateSlug,
} from './catalog-utils';

type SubsetKind = 'BASE' | 'INSERT';

export const SubsetSection = observer(function SubsetSection({
  seriesSlug,
  onForbidden,
}: {
  seriesSlug: string;
  onForbidden: () => void;
}) {
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const utils = trpc.useUtils();
  const query = trpc.admin.subsets.list.useQuery({ seriesSlug }, { enabled: Boolean(seriesSlug) });
  const create = trpc.admin.subsets.create.useMutation();
  const update = trpc.admin.subsets.update.useMutation();
  const remove = trpc.admin.subsets.delete.useMutation();
  const [editing, setEditing] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SubsetKind>('BASE');
  const [sortOrder, setSortOrder] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ slug: string; name: string; cardCount: number } | null>(
    null,
  );
  const [dialogError, setDialogError] = useState<string | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const busy = create.isPending || update.isPending || remove.isPending;

  const reset = () => {
    setEditing(null);
    setSlug('');
    setName('');
    setKind('BASE');
    setSortOrder('0');
    setErrors({});
    setFormError(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!editing) {
      const slugError = validateSlug(slug, locale.locale);
      if (slugError) next.slug = slugError;
    }
    const nameError = validateRequiredText(name, 120, locale.locale);
    if (nameError) next.name = nameError;
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) next.sortOrder = tt('admin.error.invalidType');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const input = {
      seriesSlug,
      slug: editing ?? slug.trim(),
      name: name.trim(),
      kind,
      sortOrder: order,
    };
    try {
      if (editing) await update.mutateAsync(input);
      else await create.mutateAsync(input);
      await utils.admin.subsets.list.invalidate({ seriesSlug });
      await utils.series.bySlug.invalidate({ slug: seriesSlug });
      reset();
    } catch (error) {
      if (isAccessRevoked(error)) {
        onForbidden();
        return;
      }
      const code = (error as { data?: { adminCatalogError?: { code?: string } } }).data
        ?.adminCatalogError?.code;
      if (code === 'SLUG_TAKEN') {
        setErrors({ slug: tt('admin.error.slugTaken') });
        return;
      }
      setFormError(failureText(locale.locale, error, 'admin.saveFailed'));
    }
  };

  const confirmDelete = async () => {
    if (!pending) return;
    try {
      await remove.mutateAsync({ seriesSlug, slug: pending.slug });
      await utils.admin.subsets.list.invalidate({ seriesSlug });
      await utils.series.bySlug.invalidate({ slug: seriesSlug });
      setPending(null);
    } catch (error) {
      if (readTrpcFailure(error).trpcCode === 'FORBIDDEN') {
        setDialogError(tt('error.app.FORBIDDEN'));
        actionRef.current?.focus();
        return;
      }
      setDialogError(failureText(locale.locale, error, 'admin.deleteFailed'));
      actionRef.current?.focus();
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="subset-heading">
      <h2 id="subset-heading" className="text-lg font-semibold text-neutral-900">
        {tt('admin.subset.title')}
      </h2>
      {query.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {tt('state.error')}
        </p>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-neutral-600">{tt('admin.subset.empty')}</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {query.data?.items.map((subset) => (
            <li
              key={subset.slug}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-neutral-900 wrap-anywhere">{subset.name}</p>
                <p className="font-mono text-xs text-neutral-600 wrap-anywhere">
                  {subset.slug} ·{' '}
                  {subset.kind === 'INSERT'
                    ? tt('admin.subset.kindInsert')
                    : tt('admin.subset.kindBase')}{' '}
                  · {subset.cardCount}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(subset.slug);
                    setSlug(subset.slug);
                    setName(subset.name);
                    setKind(subset.kind);
                    setSortOrder(String(subset.sortOrder));
                  }}
                >
                  {tt('admin.action.edit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setPending({
                      slug: subset.slug,
                      name: subset.name,
                      cardCount: subset.cardCount,
                    })
                  }
                >
                  {tt('admin.action.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="max-w-2xl space-y-4 rounded-xl border border-neutral-200 bg-white p-4"
        onSubmit={(event) => void onSubmit(event)}
      >
        <h3 className="text-base font-semibold text-neutral-900">
          {editing ? tt('admin.subset.edit') : tt('admin.subset.new')}
        </h3>
        {editing ? (
          <p className="font-mono text-sm text-neutral-700">{slug}</p>
        ) : (
          <AdminField id="subset-slug" label={tt('admin.field.slug')} error={errors.slug}>
            <Input
              value={slug}
              autoComplete="off"
              className="font-mono"
              onChange={(event) => setSlug(event.target.value)}
            />
          </AdminField>
        )}
        <AdminField id="subset-name" label={tt('admin.field.name')} error={errors.name}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </AdminField>
        <SegmentedControl
          name="subset-kind"
          legend={tt('admin.subset.title')}
          legendSrOnly
          value={kind}
          onValueChange={(value) => setKind(value as SubsetKind)}
          options={[
            { value: 'BASE', label: tt('admin.subset.kindBase') },
            { value: 'INSERT', label: tt('admin.subset.kindInsert') },
          ]}
        />
        <AdminField id="subset-sort" label={tt('admin.field.sortOrder')} error={errors.sortOrder}>
          <Input
            type="number"
            inputMode="numeric"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </AdminField>
        {formError ? (
          <p role="alert" className="text-sm text-red-700">
            {formError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {tt('admin.form.save')}
          </Button>
          {editing ? (
            <Button type="button" variant="outline" onClick={reset}>
              {tt('admin.cancel')}
            </Button>
          ) : null}
        </div>
      </form>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPending(null);
          setDialogError(null);
        }}
      >
        <AlertDialogContent variant="destructive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tt('admin.subset.deleteTitle', { name: pending?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tt('admin.subset.deleteBody', { count: pending?.cardCount ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialogError ? (
            <p role="alert" className="text-sm text-red-700">
              {dialogError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{tt('admin.cancel')}</AlertDialogCancel>
            <Button
              ref={actionRef}
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              {tt('admin.action.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
});
