import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { t } from '@repo/shared';
import { Button, Card, Input } from '@repo/ui-web';
import { AdminField } from '../../components/admin/admin-field';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { AdminEmpty, AdminErrorBox } from '../../components/admin/admin-table';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import {
  applyValidationFeedback,
  isAccessRevoked,
  validateOptionalText,
  validateRequiredText,
  validateSlug,
} from '../../components/admin/catalog-utils';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import { useUnsavedChanges } from '../../components/admin/use-unsaved-changes';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

export const NewCategoryPage = observer(function NewCategoryPage() {
  return <CategoryForm mode="create" />;
});

export const EditCategoryPage = observer(function EditCategoryPage() {
  return <CategoryForm mode="edit" />;
});

const CategoryForm = observer(function CategoryForm({ mode }: { mode: 'create' | 'edit' }) {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const utils = trpc.useUtils();
  const list = trpc.admin.categories.list.useQuery(undefined, { enabled: mode === 'edit' });
  const create = trpc.admin.categories.create.useMutation();
  const update = trpc.admin.categories.update.useMutation();
  const existing = list.data?.items.find((item) => item.slug === slug);
  const [slugValue, setSlugValue] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [ready, setReady] = useState(mode === 'create');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const view = queryFallback(list);
  useFocusOnRecovery(view, headingRef);
  const revoked = list.isError && isAccessRevoked(list.error);
  const saving = create.isPending || update.isPending;
  const pageTitle = mode === 'create' ? tt('admin.category.new') : tt('admin.category.edit');
  const dirty =
    ready &&
    (slugValue !== (existing?.slug ?? '') ||
      name !== (existing?.name ?? '') ||
      description !== (existing?.description ?? '') ||
      sortOrder !== String(existing?.sortOrder ?? 0));
  const unsaved = useUnsavedChanges(
    mode === 'create'
      ? slugValue !== '' || name !== '' || description !== '' || sortOrder !== '0'
      : dirty,
  );

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [reportForbidden, revoked]);

  useEffect(() => {
    if (mode !== 'edit' || !existing || ready) return;
    setSlugValue(existing.slug);
    setName(existing.name);
    setDescription(existing.description ?? '');
    setSortOrder(String(existing.sortOrder));
    setReady(true);
  }, [existing, mode, ready]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (mode === 'create') {
      const slugError = validateSlug(slugValue, locale.locale);
      if (slugError) next.slug = slugError;
    }
    const nameError = validateRequiredText(name, 120, locale.locale);
    if (nameError) next.name = nameError;
    const descriptionError = validateOptionalText(description, 5000, locale.locale);
    if (descriptionError) next.description = descriptionError;
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) next.sortOrder = tt('admin.error.invalidType');
    setErrors(next);
    if (Object.keys(next).length > 0) {
      (next.slug ? slugRef : nameRef).current?.focus();
      return;
    }
    const input = {
      slug: mode === 'create' ? slugValue.trim() : slug,
      name: name.trim(),
      description: description.trim() || undefined,
      sortOrder: order,
    };
    try {
      if (mode === 'create') await create.mutateAsync(input);
      else await update.mutateAsync(input);
      await utils.admin.categories.list.invalidate();
      await utils.categories.list.invalidate();
      unsaved.allowLeave();
      navigate('/admin/catalog/categories', {
        state: {
          notice:
            mode === 'create'
              ? tt('admin.category.created', { name: input.name })
              : tt('admin.saved'),
        },
      });
    } catch (error) {
      if (isAccessRevoked(error)) {
        reportForbidden();
        return;
      }
      const code = (error as { data?: { adminCatalogError?: { code?: string } } }).data
        ?.adminCatalogError?.code;
      if (code === 'SLUG_TAKEN') {
        setErrors({ slug: tt('admin.error.slugTaken') });
        slugRef.current?.focus();
        return;
      }
      const feedback = applyValidationFeedback(locale.locale, error, 'admin.saveFailed', [
        'slug',
        'name',
        'description',
        'sortOrder',
      ]);
      setErrors(feedback.fields);
      setFormError(feedback.message);
    }
  };

  return (
    <PageShell>
      <PageMeta title={pageTitle} />
      <div className="space-y-6">
        <AdminGate>
          {unsaved.dialog}
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('nav.admin') },
              { label: tt('nav.catalog'), to: '/admin/catalog' },
              { label: tt('admin.catalog.categoriesTab'), to: '/admin/catalog/categories' },
              { label: pageTitle },
            ]}
          />
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {pageTitle}
          </h1>
          {mode === 'edit' && view === 'error' ? (
            revoked ? null : (
              <AdminErrorBox
                title={tt('state.error')}
                onRetry={() => void list.refetch()}
                retrying={list.isFetching}
                retryLabel={tt('state.retry')}
                retryingLabel={tt('state.retrying')}
              />
            )
          ) : mode === 'edit' && view === 'loading' ? (
            <div className="h-24 animate-pulse motion-reduce:animate-none rounded-lg bg-white/60" />
          ) : mode === 'edit' && ready === false && !existing && view === 'ready' ? (
            <AdminEmpty>{tt('state.notFound')}</AdminEmpty>
          ) : (
            <Card className="max-w-2xl p-6">
              <form className="space-y-5" noValidate onSubmit={(event) => void onSubmit(event)}>
                {mode === 'create' ? (
                  <AdminField id="category-slug" label={tt('admin.field.slug')} error={errors.slug}>
                    <Input
                      ref={slugRef}
                      value={slugValue}
                      autoComplete="off"
                      className="font-mono"
                      onChange={(event) => setSlugValue(event.target.value)}
                    />
                  </AdminField>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-neutral-800">{tt('admin.field.slug')}</p>
                    <p className="font-mono text-sm text-neutral-900">{slug}</p>
                  </div>
                )}
                <AdminField
                  id="category-name"
                  label={tt('admin.field.name')}
                  error={errors.name}
                  count={name.length}
                  max={120}
                >
                  <Input
                    ref={nameRef}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </AdminField>
                <AdminField
                  id="category-description"
                  label={tt('admin.field.description')}
                  error={errors.description}
                >
                  <textarea
                    rows={4}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="flex w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  />
                </AdminField>
                <AdminField
                  id="category-sort"
                  label={tt('admin.field.sortOrder')}
                  error={errors.sortOrder}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={sortOrder}
                    onChange={(event) => setSortOrder(event.target.value)}
                  />
                </AdminField>
                {formError ? (
                  <p
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    {formError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-3">
                  <Button asChild variant="outline">
                    <Link to="/admin/catalog/categories">{tt('admin.cancel')}</Link>
                  </Button>
                  <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
                    {saving ? tt('admin.form.saving') : tt('admin.form.save')}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </AdminGate>
      </div>
    </PageShell>
  );
});
