import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { t, type Rarity } from '@repo/shared';
import { Button, Card, Input } from '@repo/ui-web';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui-web';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { PageMeta } from '../../components/page-meta';
import { PageShell } from '../../components/page-shell';
import { RARITY_LABELS } from '../../components/rarity-badge';
import { AdminField } from '../../components/admin/admin-field';
import { AdminGate, useReportForbidden } from '../../components/admin/admin-gate';
import { AdminEmpty, AdminErrorBox } from '../../components/admin/admin-table';
import { queryFallback, useFocusOnRecovery } from '../../components/retry-button';
import { AttributesEditor } from '../../components/admin/attributes-editor';
import { ImageUrlField, imageUrlError } from '../../components/admin/image-url-field';
import {
  attributeSnapshots,
  sameAttributeRows,
  useRedirectOnSessionExpiry,
  useUnsavedChanges,
  type AttributeSnapshot,
} from '../../components/admin/use-unsaved-changes';
import {
  applyValidationFeedback,
  attributesToRows,
  isAccessRevoked,
  validateAttributeRows,
  validateOptionalText,
  validateRequiredText,
  validateSlug,
  type AdminCardItem,
  type AdminSeriesItem,
  type AttributeRow,
} from '../../components/admin/catalog-utils';
import { trpc } from '../../lib/trpc';
import { useStores } from '../../stores/root-store';

const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;

export const NewCardPage = observer(function NewCardPage() {
  return <CardForm mode="create" />;
});

export const EditCardPage = observer(function EditCardPage() {
  return <CardForm mode="edit" />;
});

const CardForm = observer(function CardForm({ mode }: { mode: 'create' | 'edit' }) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const title = mode === 'create' ? tt('admin.cards.new') : tt('admin.cards.edit');
  useRedirectOnSessionExpiry();
  return (
    <PageShell>
      <PageMeta title={title} />
      <div className="space-y-6">
        <AdminGate>
          <CardFormBody mode={mode} />
        </AdminGate>
      </div>
    </PageShell>
  );
});

interface CardBaseline {
  seriesSlug: string;
  slug: string;
  name: string;
  rarity: Rarity;
  description: string;
  imageUrl: string;
  attributes: AttributeSnapshot[];
  subsetSlug: string;
  cardNumber: string;
}

const CardFormBody = observer(function CardFormBody({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams();
  const routeSlug = params.slug ?? '';
  const navigate = useNavigate();
  const { locale } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const reportForbidden = useReportForbidden();
  const utils = trpc.useUtils();
  const seriesQuery = trpc.admin.series.list.useQuery();
  const cardQuery = trpc.admin.cards.get.useQuery(
    { slug: routeSlug },
    { enabled: mode === 'edit' && Boolean(routeSlug) },
  );
  const create = trpc.admin.cards.create.useMutation();
  const update = trpc.admin.cards.update.useMutation();
  const seriesItems = (seriesQuery.data?.items ?? []) as AdminSeriesItem[];
  const card = cardQuery.data as AdminCardItem | undefined;
  const [seriesSlug, setSeriesSlug] = useState(mode === 'create' ? routeSlug : '');
  const [slugValue, setSlugValue] = useState('');
  const [name, setName] = useState('');
  const [rarity, setRarity] = useState<Rarity>('common');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [subsetSlug, setSubsetSlug] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const subsetsQuery = trpc.admin.subsets.list.useQuery(
    { seriesSlug },
    { enabled: Boolean(seriesSlug) },
  );
  const [rows, setRows] = useState<AttributeRow[]>([]);
  const [attrErrors, setAttrErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(mode === 'create');
  const [baseline, setBaseline] = useState<CardBaseline | null>(
    mode === 'create'
      ? {
          seriesSlug: routeSlug,
          slug: '',
          name: '',
          rarity: 'common',
          description: '',
          imageUrl: '',
          attributes: [],
          subsetSlug: '',
          cardNumber: '',
        }
      : null,
  );
  const titleRef = useRef<HTMLHeadingElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const saving = create.isPending || update.isPending;
  const revoked =
    (seriesQuery.isError && isAccessRevoked(seriesQuery.error)) ||
    (cardQuery.isError && isAccessRevoked(cardQuery.error));

  useEffect(() => {
    if (revoked) reportForbidden();
  }, [revoked, reportForbidden]);

  useEffect(() => {
    if (mode !== 'edit' || !card || hydrated) return;
    const nextRows = attributesToRows(card.attributes ?? {});
    const next = {
      seriesSlug: card.seriesSlug,
      slug: card.slug,
      name: card.name,
      rarity: card.rarity,
      description: card.description ?? '',
      imageUrl: card.imageUrl ?? '',
      attributes: attributeSnapshots(nextRows),
      subsetSlug: card.subsetSlug ?? '',
      cardNumber: card.cardNumber ?? '',
    };
    setSeriesSlug(next.seriesSlug);
    setSlugValue(next.slug);
    setName(next.name);
    setRarity(next.rarity);
    setDescription(next.description);
    setImageUrl(next.imageUrl);
    setSubsetSlug(next.subsetSlug);
    setCardNumber(next.cardNumber);
    setRows(nextRows);
    setBaseline(next);
    setHydrated(true);
  }, [card, hydrated, mode]);

  const dirty =
    baseline !== null &&
    (seriesSlug !== baseline.seriesSlug ||
      slugValue !== baseline.slug ||
      name !== baseline.name ||
      rarity !== baseline.rarity ||
      description !== baseline.description ||
      imageUrl !== baseline.imageUrl ||
      subsetSlug !== baseline.subsetSlug ||
      cardNumber !== baseline.cardNumber ||
      !sameAttributeRows(attributeSnapshots(rows), baseline.attributes));
  const unsaved = useUnsavedChanges(dirty);

  const pageTitle = mode === 'create' ? tt('admin.cards.new') : tt('admin.cards.edit');
  const seriesForCrumb =
    seriesItems.find((item) => item.slug === (mode === 'edit' ? card?.seriesSlug : routeSlug)) ??
    null;
  const formView = queryFallback(seriesQuery, ...(mode === 'edit' ? [cardQuery] : []));
  useFocusOnRecovery(formView, titleRef);
  const missingSeries = mode === 'create' && !seriesQuery.isLoading && !seriesForCrumb;
  const missingCard = mode === 'edit' && !cardQuery.isLoading && !cardQuery.isError && !card;

  const focusField = (key: string) => {
    if (key === 'slug') slugRef.current?.focus();
    if (key === 'name') nameRef.current?.focus();
    if (key === 'description') descriptionRef.current?.focus();
    if (key === 'imageUrl') imageRef.current?.focus();
    if (key === 'cardNumber') document.getElementById('card-number')?.focus();
    if (key === 'subsetSlug') document.getElementById('card-subset')?.focus();
    if (key === 'series') {
      document.getElementById('card-series')?.focus();
    }
    if (key === 'attributes') {
      const row = rows.find((item) => attrErrors[item.id]);
      if (row) {
        document.querySelector<HTMLInputElement>(`[data-attr-key="${row.id}"]`)?.focus();
      }
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!seriesSlug) next.series = tt('admin.error.required');
    if (mode === 'create') {
      const slugError = validateSlug(slugValue, locale.locale);
      if (slugError) next.slug = slugError;
    }
    const nameError = validateRequiredText(name, 120, locale.locale);
    if (nameError) next.name = nameError;
    const descriptionError = validateOptionalText(description, 5000, locale.locale);
    if (descriptionError) next.description = descriptionError;
    const imageError = imageUrlError(imageUrl, locale.locale);
    if (imageError) next.imageUrl = imageError;
    if (cardNumber.trim().length > 20) next.cardNumber = tt('error.field.too_big');
    const attributes = validateAttributeRows(rows, locale.locale);
    setErrors(next);
    setAttrErrors(attributes.ok ? {} : attributes.errors);
    if (Object.keys(next).length > 0) {
      const order = [
        'series',
        'slug',
        'subsetSlug',
        'cardNumber',
        'name',
        'description',
        'imageUrl',
      ];
      const first = order.find((key) => next[key]);
      if (first) focusField(first);
      return;
    }
    if (!attributes.ok) {
      const row = rows.find((item) => attributes.errors[item.id]);
      document.querySelector<HTMLInputElement>(`[data-attr-key="${row?.id}"]`)?.focus();
      return;
    }
    const previousSeriesSlug = mode === 'edit' ? card?.seriesSlug : undefined;
    const input = {
      slug: mode === 'create' ? slugValue.trim() : routeSlug,
      name: name.trim(),
      description: description.trim() || undefined,
      rarity,
      imageUrl: imageUrl.trim() || undefined,
      attributes: attributes.attributes,
      seriesSlug,
      subsetSlug,
      cardNumber: cardNumber.trim(),
    };
    try {
      if (mode === 'create') {
        await create.mutateAsync(input);
      } else {
        await update.mutateAsync(input);
      }
      void utils.admin.series.list.invalidate();
      void utils.series.bySlug.invalidate({ slug: seriesSlug });
      if (previousSeriesSlug && previousSeriesSlug !== seriesSlug) {
        void utils.series.bySlug.invalidate({ slug: previousSeriesSlug });
      }
      void utils.admin.cards.get.invalidate({ slug: input.slug });
      unsaved.allowLeave();
      navigate(`/admin/catalog/series/${seriesSlug}`, {
        state: {
          notice:
            mode === 'create' ? tt('admin.cards.created', { name: input.name }) : tt('admin.saved'),
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
      if (code === 'SERIES_NOT_FOUND') {
        setErrors({ series: tt('admin.error.seriesNotFound') });
        focusField('series');
        return;
      }
      if (code === 'INVALID_RARITY') {
        setErrors({ rarity: tt('admin.error.rarity') });
        return;
      }
      const feedback = applyValidationFeedback(locale.locale, error, 'admin.saveFailed', [
        'series',
        'slug',
        'subsetSlug',
        'cardNumber',
        'name',
        'description',
        'imageUrl',
        'rarity',
        'attributes',
      ]);
      const attributeMessage = feedback.fields.attributes;
      const fieldErrors = { ...feedback.fields };
      delete fieldErrors.attributes;
      if (Object.keys(fieldErrors).length > 0 || attributeMessage) {
        setErrors({
          ...fieldErrors,
          ...(attributeMessage ? { attributes: attributeMessage } : {}),
        });
        const order = [
          'series',
          'slug',
          'subsetSlug',
          'cardNumber',
          'name',
          'description',
          'imageUrl',
          'rarity',
        ];
        const first = order.find((key) => fieldErrors[key]);
        if (first) focusField(first);
        else document.getElementById('card-attributes')?.focus();
      }
      setFormError(feedback.message);
    }
  };

  return (
    <>
      {unsaved.dialog}
      <Breadcrumbs
        items={[
          { label: tt('breadcrumb.home'), to: '/' },
          { label: tt('nav.admin') },
          { label: tt('nav.catalog'), to: '/admin/catalog' },
          ...(seriesForCrumb
            ? [
                {
                  label: seriesForCrumb.title,
                  to: `/admin/catalog/series/${seriesForCrumb.slug}`,
                },
              ]
            : []),
          { label: mode === 'edit' && card ? card.name : pageTitle },
        ]}
      />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {mode === 'edit' && card ? card.name : pageTitle}
        </h1>
      </header>
      {formView === 'error' ? (
        revoked ? null : (
          <AdminErrorBox
            title={tt('state.error')}
            onRetry={() => {
              void seriesQuery.refetch();
              if (mode === 'edit') void cardQuery.refetch();
            }}
            retrying={seriesQuery.isFetching || cardQuery.isFetching}
            retryLabel={tt('state.retry')}
            retryingLabel={tt('state.retrying')}
          />
        )
      ) : formView === 'loading' ? (
        <div role="status" className="max-w-2xl rounded-lg border border-neutral-200 bg-white p-6">
          <div className="h-4 w-40 animate-pulse motion-reduce:animate-none rounded bg-neutral-200" />
        </div>
      ) : missingSeries || missingCard ? (
        <AdminEmpty>{tt('state.notFound')}</AdminEmpty>
      ) : (
        <Card className="max-w-2xl p-6">
          <form className="space-y-5" noValidate onSubmit={(event) => void onSubmit(event)}>
            <div className="space-y-1">
              <label htmlFor="card-series" className="text-sm font-medium text-neutral-800">
                {tt('admin.field.series')}
              </label>
              <Select value={seriesSlug} onValueChange={setSeriesSlug}>
                <SelectTrigger id="card-series" aria-invalid={errors.series ? true : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {seriesItems.map((item) => (
                    <SelectItem key={item.slug} value={item.slug}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.series ? <p className="text-xs text-red-700">{errors.series}</p> : null}
            </div>
            {mode === 'create' ? (
              <AdminField
                id="card-slug"
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
                <p className="font-mono text-sm text-neutral-900">{routeSlug}</p>
                <p className="text-xs text-neutral-600">{tt('admin.field.slugLocked')}</p>
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="card-subset" className="text-sm font-medium text-neutral-800">
                {tt('admin.field.subset')}
              </label>
              <Select
                value={subsetSlug || 'none'}
                onValueChange={(value) => setSubsetSlug(value === 'none' ? '' : value)}
              >
                <SelectTrigger
                  id="card-subset"
                  size="sm"
                  className="w-full"
                  aria-invalid={errors.subsetSlug ? true : undefined}
                  aria-describedby={errors.subsetSlug ? 'card-subset-error' : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tt('admin.field.subsetNone')}</SelectItem>
                  {(subsetsQuery.data?.items ?? []).map((subset) => (
                    <SelectItem key={subset.slug} value={subset.slug}>
                      {subset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.subsetSlug ? (
                <p id="card-subset-error" className="text-xs text-red-700">
                  {errors.subsetSlug}
                </p>
              ) : null}
            </div>
            <AdminField
              id="card-number"
              label={tt('admin.field.cardNumber')}
              hint={tt('admin.field.cardNumberHint')}
              error={errors.cardNumber}
              count={cardNumber.length}
              max={20}
            >
              <Input
                value={cardNumber}
                autoComplete="off"
                className="font-mono"
                maxLength={20}
                onChange={(event) => setCardNumber(event.target.value)}
              />
            </AdminField>
            <AdminField
              id="card-name"
              label={tt('admin.field.name')}
              error={errors.name}
              count={name.length}
              max={120}
            >
              <Input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} />
            </AdminField>
            <div className="space-y-1">
              <label htmlFor="card-rarity" className="text-sm font-medium text-neutral-800">
                {tt('admin.field.rarity')}
              </label>
              <Select value={rarity} onValueChange={(value) => setRarity(value as Rarity)}>
                <SelectTrigger id="card-rarity" aria-invalid={errors.rarity ? true : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RARITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {RARITY_LABELS[value][locale.locale]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.rarity ? <p className="text-xs text-red-700">{errors.rarity}</p> : null}
            </div>
            <AdminField
              id="card-description"
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
              id="card-image"
              label={tt('admin.field.imageUrl')}
              value={imageUrl}
              onChange={setImageUrl}
              onBlur={() => {
                const imageError = imageUrlError(imageUrl, locale.locale);
                setErrors((current) => ({ ...current, imageUrl: imageError ?? '' }));
              }}
              error={errors.imageUrl || undefined}
              ratio="63:88"
              kind="card"
              slug={mode === 'create' ? slugValue : routeSlug}
              inputRef={imageRef}
            />
            <AttributesEditor
              rows={rows}
              onChange={setRows}
              errors={attrErrors}
              formError={errors.attributes}
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
                <Link
                  to={`/admin/catalog/series/${mode === 'edit' ? (card?.seriesSlug ?? seriesSlug) : routeSlug}`}
                >
                  {tt('admin.cancel')}
                </Link>
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
