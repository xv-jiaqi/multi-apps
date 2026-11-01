import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useNavigate, useParams } from 'react-router';
import { t } from '@repo/shared';
import {
  Button,
  Card,
  Combobox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { AdminField } from '../../components/admin/admin-field';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { AdminEmpty, AdminErrorBox } from '../../components/admin/admin-table';
import { isAccessRevoked } from '../../components/admin/catalog-utils';
import {
  useRedirectOnSessionExpiry,
  useUnsavedChanges,
} from '../../components/admin/use-unsaved-changes';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import {
  normalizeReleaseDateInput,
  releaseFormErrors,
  releaseNotFound,
  releaseWriteFeedback,
  releaseWriteInput,
  type ReleaseFormValues,
} from '../../lib/release-form';
import { trpc } from '../../lib/trpc';
import { useDebounced } from '../../lib/use-debounced';
import { useStores } from '../../stores/root-store';

const emptyValues: ReleaseFormValues = {
  title: '',
  releaseDate: '',
  monthOnly: false,
  region: '',
  seriesId: null,
  categoryId: null,
  note: '',
  sourceUrl: '',
};

const fieldClass =
  'flex w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 aria-invalid:border-red-600';

type SeriesOption = { id: string; slug: string; title: string };

function sameDraft(left: ReleaseFormValues, right: ReleaseFormValues): boolean {
  return (
    left.title === right.title &&
    left.releaseDate === right.releaseDate &&
    left.monthOnly === right.monthOnly &&
    left.region === right.region &&
    left.seriesId === right.seriesId &&
    left.categoryId === right.categoryId &&
    left.note === right.note &&
    left.sourceUrl === right.sourceUrl
  );
}

function SelectControl({
  id,
  value,
  onValueChange,
  children,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  children: ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        id={id}
        className="w-full"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

export const NewReleasePage = observer(function NewReleasePage() {
  return <ReleaseForm mode="create" />;
});

export const EditReleasePage = observer(function EditReleasePage() {
  return <ReleaseForm mode="edit" />;
});

const ReleaseForm = observer(function ReleaseForm({ mode }: { mode: 'create' | 'edit' }) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const title = mode === 'create' ? tt('admin.releases.new') : tt('admin.releases.edit');
  useRedirectOnSessionExpiry();

  return (
    <PageShell>
      <PageMeta title={title} />
      <div className="space-y-6">
        <AdminGate>
          <ReleaseFormBody mode={mode} />
        </AdminGate>
      </div>
    </PageShell>
  );
});

const ReleaseFormBody = observer(function ReleaseFormBody({ mode }: { mode: 'create' | 'edit' }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const utils = trpc.useUtils();
  const categories = trpc.categories.list.useQuery();
  const loaded = trpc.admin.releases.getById.useQuery(
    { id },
    { enabled: mode === 'edit' && id.length > 0 },
  );
  const missing = loaded.isError && releaseNotFound(loaded.error);
  const create = trpc.admin.releases.create.useMutation();
  const update = trpc.admin.releases.update.useMutation();
  const [values, setValues] = useState<ReleaseFormValues>(emptyValues);
  const [baseline, setBaseline] = useState<ReleaseFormValues | null>(
    mode === 'create' ? emptyValues : null,
  );
  const [series, setSeries] = useState<SeriesOption | null>(null);
  const [seriesQuery, setSeriesQuery] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const seriesRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const debouncedSeries = useDebounced(seriesQuery, 250).trim();
  const seriesSearch = trpc.search.global.useQuery(
    { q: debouncedSeries, seriesLimit: 8, cardLimit: 1 },
    { enabled: debouncedSeries.length > 0 },
  );
  const saving = create.isPending || update.isPending;
  const editView = missing ? 'ready' : queryFallback(loaded);
  const revoked = loaded.isError && isAccessRevoked(loaded.error);
  useFocusOnRecovery(mode === 'edit' ? editView : 'ready', headingRef);

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [reportForbidden, revoked]);

  useEffect(() => {
    if (mode !== 'edit' || !loaded.data || baseline) return;
    const row = loaded.data;
    const next: ReleaseFormValues = {
      title: row.title,
      releaseDate: row.datePrecision === 'MONTH' ? row.releaseDate.slice(0, 7) : row.releaseDate,
      monthOnly: row.datePrecision === 'MONTH',
      region: row.region ?? '',
      seriesId: row.seriesId,
      categoryId: row.categoryId,
      note: row.note ?? '',
      sourceUrl: row.sourceUrl ?? '',
    };
    setValues(next);
    setBaseline(next);
    if (row.seriesId && row.series) {
      setSeries({ id: row.seriesId, slug: row.series.slug, title: row.series.title });
    }
  }, [baseline, loaded.data, mode]);

  const dirty = baseline !== null && !sameDraft(baseline, values);
  const unsaved = useUnsavedChanges(dirty);
  const pageTitle = mode === 'create' ? tt('admin.releases.new') : tt('admin.releases.edit');

  const focusFirst = (next: Record<string, string>) => {
    if (next.title) titleRef.current?.focus();
    else if (next.releaseDate) dateRef.current?.focus();
    else if (next.region) document.getElementById('release-region')?.focus();
    else if (next.seriesId) seriesRef.current?.focus();
    else if (next.categoryId) document.getElementById('release-category')?.focus();
    else if (next.note) noteRef.current?.focus();
    else if (next.sourceUrl) sourceRef.current?.focus();
  };

  const applyField = (key: string, draft: ReleaseFormValues) => {
    const next = releaseFormErrors(draft, locale.locale);
    setErrors((current) => ({ ...current, [key]: next[key] ?? '' }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const form = event.currentTarget;
    const read = (fieldId: string) => {
      const node = form.querySelector(`#${fieldId}`);
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
        return node.value;
      return '';
    };
    const monthBox = form.querySelector('#release-month-only');
    const monthOnly = monthBox instanceof HTMLInputElement ? monthBox.checked : values.monthOnly;
    const releaseDate = normalizeReleaseDateInput(read('release-date'), monthOnly);
    const draft = {
      ...values,
      title: read('release-title'),
      releaseDate,
      monthOnly,
      note: read('release-note'),
      sourceUrl: read('release-source'),
    };
    setValues(draft);
    const next = releaseFormErrors(draft, locale.locale);
    setErrors(next);
    if (Object.keys(next).filter((key) => next[key]).length > 0) {
      focusFirst(next);
      return;
    }
    const input = releaseWriteInput(draft);
    try {
      if (mode === 'create') await create.mutateAsync(input);
      else await update.mutateAsync({ ...input, id });
      void utils.admin.releases.getById.invalidate();
      void utils.admin.releases.list.invalidate();
      void utils.releases.list.invalidate();
      unsaved.allowLeave();
      navigate('/admin/releases', { state: { notice: tt('admin.releases.saved') } });
    } catch (error) {
      if (isAccessRevoked(error)) {
        reportForbidden();
        return;
      }
      const feedback = releaseWriteFeedback(locale.locale, error);
      setErrors(feedback.fields);
      setFormError(feedback.message);
      if (Object.keys(feedback.fields).length > 0) focusFirst(feedback.fields);
      else alertRef.current?.focus();
    }
  };

  const seriesStatus =
    debouncedSeries.length === 0
      ? 'idle'
      : seriesSearch.isLoading || seriesSearch.isFetching
        ? 'loading'
        : seriesSearch.isError
          ? 'error'
          : 'success';
  const seriesOptions: SeriesOption[] =
    seriesSearch.data?.series.map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
    })) ?? [];
  const categoryItems = categories.data?.items ?? [];
  const categoryKnown =
    values.categoryId === null || categoryItems.some((item) => item.id === values.categoryId);
  const savedCategory = loaded.data?.category;

  const form = (
    <Card className="max-w-2xl p-6">
      <form className="space-y-5" noValidate onSubmit={(event) => void onSubmit(event)}>
        <AdminField
          id="release-title"
          label={tt('admin.field.title')}
          error={errors.title || undefined}
          count={values.title.length}
          max={120}
        >
          <Input
            ref={titleRef}
            value={values.title}
            autoComplete="off"
            onChange={(event) =>
              setValues((current) => ({ ...current, title: event.target.value }))
            }
            onBlur={(event) => applyField('title', { ...values, title: event.target.value })}
          />
        </AdminField>
        <AdminField
          id="release-date"
          label={tt('admin.field.releaseDate')}
          hint={
            values.monthOnly ? tt('admin.releases.dateHintMonth') : tt('admin.releases.dateHint')
          }
          error={errors.releaseDate || undefined}
        >
          <Input
            ref={dateRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={values.releaseDate}
            onChange={(event) =>
              setValues((current) => ({ ...current, releaseDate: event.target.value }))
            }
            onBlur={(event) => {
              const releaseDate = normalizeReleaseDateInput(event.target.value, values.monthOnly);
              const draft = { ...values, releaseDate };
              setValues(draft);
              applyField('releaseDate', draft);
            }}
          />
        </AdminField>
        <AdminField id="release-month-only" label={tt('admin.releases.monthOnly')}>
          <input
            type="checkbox"
            className="size-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            checked={values.monthOnly}
            onChange={(event) => {
              const monthOnly = event.target.checked;
              const releaseDate = normalizeReleaseDateInput(values.releaseDate, monthOnly);
              const draft = { ...values, monthOnly, releaseDate };
              setValues(draft);
              applyField('releaseDate', draft);
            }}
          />
        </AdminField>
        <AdminField
          id="release-region"
          label={tt('admin.releases.region')}
          error={errors.region || undefined}
        >
          <SelectControl
            value={values.region || 'any'}
            onValueChange={(value) => {
              const region = (value === 'any' ? '' : value) as ReleaseFormValues['region'];
              const draft = { ...values, region };
              setValues(draft);
              applyField('region', draft);
            }}
          >
            <SelectItem value="any">{tt('admin.releases.regionAny')}</SelectItem>
            <SelectItem value="CN">{tt('region.CN')}</SelectItem>
            <SelectItem value="JP">{tt('region.JP')}</SelectItem>
            <SelectItem value="GLOBAL">{tt('region.GLOBAL')}</SelectItem>
          </SelectControl>
        </AdminField>
        <AdminField
          id="release-series"
          label={tt('admin.releases.series')}
          error={errors.seriesId || undefined}
        >
          <Combobox<SeriesOption>
            mode="select"
            value={series}
            inputRef={seriesRef}
            inputValue={seriesQuery}
            onInputValueChange={setSeriesQuery}
            onValueChange={(next) => {
              setSeries(next);
              setValues((current) => ({ ...current, seriesId: next?.id ?? null }));
              setErrors((current) => ({ ...current, seriesId: '' }));
            }}
            groups={[{ key: 'series', items: seriesOptions }]}
            getKey={(item) => item.id}
            getItemText={(item) => item.title}
            renderItem={(item) => <span className="block truncate text-sm">{item.title}</span>}
            status={seriesStatus}
            onRetry={() => void seriesSearch.refetch()}
            placeholder={tt('admin.releases.seriesPlaceholder')}
            labels={{
              empty: tt('admin.releases.seriesEmpty'),
              loading: tt('form.searching'),
              error: tt('form.searchFailed'),
              retry: tt('state.retry'),
              clear: tt('form.clear'),
              resultsCount: (count) => tt('form.resultsCount', { count }),
            }}
          />
        </AdminField>
        <AdminField
          id="release-category"
          label={tt('admin.field.category')}
          error={errors.categoryId || undefined}
        >
          <SelectControl
            value={values.categoryId ?? 'none'}
            onValueChange={(value) => {
              const draft = { ...values, categoryId: value === 'none' ? null : value };
              setValues(draft);
              applyField('categoryId', draft);
            }}
          >
            <SelectItem value="none">{tt('admin.releases.categoryNone')}</SelectItem>
            {!categoryKnown && values.categoryId ? (
              <SelectItem value={values.categoryId}>
                {savedCategory?.name ?? values.categoryId}
              </SelectItem>
            ) : null}
            {categoryItems.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectControl>
        </AdminField>
        <AdminField
          id="release-note"
          label={tt('admin.releases.note')}
          error={errors.note || undefined}
          count={values.note.length}
          max={500}
        >
          <textarea
            ref={noteRef}
            rows={4}
            value={values.note}
            className={fieldClass}
            onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))}
            onBlur={(event) => applyField('note', { ...values, note: event.target.value })}
          />
        </AdminField>
        <AdminField
          id="release-source"
          label={tt('admin.releases.sourceUrl')}
          hint={tt('admin.releases.sourceHint')}
          error={errors.sourceUrl || undefined}
        >
          <Input
            ref={sourceRef}
            type="url"
            autoComplete="off"
            value={values.sourceUrl}
            onChange={(event) =>
              setValues((current) => ({ ...current, sourceUrl: event.target.value }))
            }
            onBlur={(event) =>
              applyField('sourceUrl', { ...values, sourceUrl: event.target.value })
            }
          />
        </AdminField>
        {formError ? (
          <p
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {formError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button asChild variant="outline">
            <Link to="/admin/releases">{tt('admin.cancel')}</Link>
          </Button>
          <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
            {saving ? tt('admin.form.saving') : tt('admin.form.save')}
          </Button>
        </div>
      </form>
    </Card>
  );

  return (
    <>
      {unsaved.dialog}
      <Breadcrumbs
        items={[
          { label: tt('breadcrumb.home'), to: '/' },
          { label: tt('nav.admin') },
          { label: tt('nav.releases'), to: '/admin/releases' },
          { label: pageTitle },
        ]}
      />
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-3xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {pageTitle}
      </h1>
      {mode === 'edit' && editView === 'error' ? (
        revoked ? null : (
          <AdminErrorBox
            title={tt('admin.releases.loadError')}
            onRetry={() => void loaded.refetch()}
            retrying={loaded.isFetching}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
          />
        )
      ) : mode === 'edit' && editView === 'loading' ? (
        <div role="status" className="max-w-2xl rounded-lg border border-neutral-200 bg-white p-6">
          <div className="h-4 w-40 animate-pulse motion-reduce:animate-none rounded bg-neutral-200" />
        </div>
      ) : mode === 'edit' && missing ? (
        <AdminEmpty>{tt('admin.releases.missing')}</AdminEmpty>
      ) : (
        form
      )}
    </>
  );
});
