import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { t } from '@repo/shared';
import { Button, Card, Input } from '@repo/ui-web';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { AdminField } from '../../components/admin/admin-field';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { AdminEmpty, AdminErrorBox } from '../../components/admin/admin-table';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import { ImageUrlField, imageUrlError } from '../../components/admin/image-url-field';
import {
  applyValidationFeedback,
  isAccessRevoked,
  validateOptionalText,
  validateRequiredText,
  validateSlug,
  type AdminSeriesItem,
} from '../../components/admin/catalog-utils';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

export const NewSeriesPage = observer(function NewSeriesPage() {
  return <SeriesForm mode="create" />;
});

export const EditSeriesPage = observer(function EditSeriesPage() {
  return <SeriesForm mode="edit" />;
});

const SeriesForm = observer(function SeriesForm({ mode }: { mode: 'create' | 'edit' }) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const title = mode === 'create' ? tt('admin.series.new') : tt('admin.series.edit');

  return (
    <PageShell>
      <PageMeta title={title} />
      <div className="space-y-6">
        <AdminGate>
          <SeriesFormBody mode={mode} />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const SeriesFormBody = observer(function SeriesFormBody({ mode }: { mode: 'create' | 'edit' }) {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const list = trpc.admin.series.list.useQuery(undefined, { enabled: mode === 'edit' });
  const utils = trpc.useUtils();
  const create = trpc.admin.series.create.useMutation();
  const update = trpc.admin.series.update.useMutation();
  const existing = ((list.data?.items ?? []) as AdminSeriesItem[]).find(
    (item) => item.slug === slug,
  );
  const [slugValue, setSlugValue] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [ready, setReady] = useState(mode === 'create');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const saving = create.isPending || update.isPending;
  const revoked = list.isError && isAccessRevoked(list.error);
  const editView = queryFallback(list);
  useFocusOnRecovery(editView, headingRef);

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [revoked, reportForbidden]);

  useEffect(() => {
    if (mode !== 'edit' || !existing || ready) return;
    setSlugValue(existing.slug);
    setTitle(existing.title);
    setDescription(existing.description ?? '');
    setCoverUrl(existing.coverUrl ?? '');
    setReady(true);
  }, [existing, mode, ready]);

  const pageTitle = mode === 'create' ? tt('admin.series.new') : tt('admin.series.edit');

  const validate = () => {
    const next: Record<string, string> = {};
    if (mode === 'create') {
      const slugError = validateSlug(slugValue, locale.locale);
      if (slugError) next.slug = slugError;
    }
    const titleError = validateRequiredText(title, 120, locale.locale);
    if (titleError) next.title = titleError;
    const descriptionError = validateOptionalText(description, 5000, locale.locale);
    if (descriptionError) next.description = descriptionError;
    const imageError = imageUrlError(coverUrl, locale.locale);
    if (imageError) next.coverUrl = imageError;
    return next;
  };

  const focusFirst = (next: Record<string, string>) => {
    const order = [
      ['slug', slugRef],
      ['title', titleRef],
      ['description', descriptionRef],
      ['coverUrl', coverRef],
    ] as const;
    const match = order.find(([key]) => next[key]);
    match?.[1].current?.focus();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirst(next);
      return;
    }
    const submittedSlug = mode === 'create' ? slugValue.trim() : slug;
    const input = {
      slug: submittedSlug,
      title: title.trim(),
      description: description.trim() || undefined,
      coverUrl: coverUrl.trim() || undefined,
    };
    try {
      if (mode === 'create') {
        await create.mutateAsync(input);
      } else {
        await update.mutateAsync(input);
      }
      void utils.admin.series.list.invalidate();
      void utils.series.list.invalidate();
      void utils.series.bySlug.invalidate({ slug: submittedSlug });
      navigate('/admin/catalog', {
        state: {
          notice:
            mode === 'create'
              ? tt('admin.series.created', { title: input.title })
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
        'title',
        'description',
        'coverUrl',
      ]);
      if (Object.keys(feedback.fields).length > 0) {
        setErrors(feedback.fields);
        focusFirst(feedback.fields);
      }
      setFormError(feedback.message);
    }
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: tt('breadcrumb.home'), to: '/' },
          { label: tt('nav.admin') },
          { label: tt('nav.catalog'), to: '/admin/catalog' },
          ...(mode === 'edit' && existing
            ? [{ label: existing.title, to: `/admin/catalog/series/${existing.slug}` }]
            : []),
          { label: pageTitle },
        ]}
      />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {pageTitle}
        </h1>
      </header>
      {mode === 'edit' && editView === 'error' ? (
        revoked ? null : (
          <AdminErrorBox
            title={tt('state.error')}
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
          />
        )
      ) : mode === 'edit' && editView === 'loading' ? (
        <div role="status" className="max-w-2xl rounded-lg border border-neutral-200 bg-white p-6">
          <div className="h-4 w-40 animate-pulse rounded bg-neutral-200" />
        </div>
      ) : mode === 'edit' && !existing ? (
        <AdminEmpty>{tt('state.notFound')}</AdminEmpty>
      ) : (
        <Card className="max-w-2xl p-6">
          <form className="space-y-5" noValidate onSubmit={(event) => void onSubmit(event)}>
            {mode === 'create' ? (
              <AdminField
                id="series-slug"
                label={tt('admin.field.slug')}
                hint={tt('admin.field.slugHint')}
                error={errors.slug}
              >
                <Input
                  ref={slugRef}
                  value={slugValue}
                  autoComplete="off"
                  className="font-mono"
                  onChange={(event) => setSlugValue(event.target.value)}
                  onBlur={() => {
                    const slugError = validateSlug(slugValue, locale.locale);
                    setErrors((current) => ({ ...current, slug: slugError ?? '' }));
                  }}
                />
              </AdminField>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-neutral-800">{tt('admin.field.slug')}</p>
                <p className="font-mono text-sm text-neutral-900">{slug}</p>
                <p className="text-xs text-neutral-600">{tt('admin.field.slugLocked')}</p>
              </div>
            )}
            <AdminField
              id="series-title"
              label={tt('admin.field.title')}
              error={errors.title}
              count={title.length}
              max={120}
            >
              <Input
                ref={titleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </AdminField>
            <AdminField
              id="series-description"
              label={tt('admin.field.description')}
              error={errors.description}
              count={description.length}
              max={5000}
            >
              <textarea
                ref={descriptionRef}
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="flex w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 shadow-sm placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 aria-invalid:border-red-600 sm:text-sm"
              />
            </AdminField>
            <ImageUrlField
              id="series-cover"
              label={tt('admin.field.coverUrl')}
              value={coverUrl}
              onChange={setCoverUrl}
              onBlur={() => {
                const imageError = imageUrlError(coverUrl, locale.locale);
                setErrors((current) => ({ ...current, coverUrl: imageError ?? '' }));
              }}
              error={errors.coverUrl || undefined}
              ratio="2:1"
              kind="cover"
              slug={mode === 'create' ? slugValue : slug}
              inputRef={coverRef}
            />
            {formError ? (
              <p
                role="alert"
                className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {formError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button asChild variant="outline">
                <Link to="/admin/catalog">{tt('admin.cancel')}</Link>
              </Button>
              <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
                {saving
                  ? tt('admin.form.saving')
                  : mode === 'create'
                    ? tt('admin.form.create')
                    : tt('admin.form.save')}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
});
