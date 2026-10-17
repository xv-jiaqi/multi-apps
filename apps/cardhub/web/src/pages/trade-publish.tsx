import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
} from '@repo/ui-web';
import {
  LISTING_CONDITION_VALUES,
  LISTING_KIND_VALUES,
  LISTING_LANGUAGE_VALUES,
  TRADE_CURRENCY_VALUES,
  listingPublishInput,
  t,
  type ListingCondition,
  type ListingKind,
  type ListingLanguage,
  type TradeCurrency,
} from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';
import { CardPicker, type CardPickerItem } from '../components/card-picker';
import { CardThumb, isHttpsImageUrl } from '../components/card-thumb';
import { RarityBadge } from '../components/rarity-badge';

type FieldErrors = Partial<Record<'card' | 'price' | 'imageUrls' | 'contact', string>>;

function isKnownRarity(rarity: string | null): rarity is 'common' | 'rare' | 'epic' | 'legendary' {
  return rarity === 'common' || rarity === 'rare' || rarity === 'epic' || rarity === 'legendary';
}
function PublishImagePreview({ url, fallback }: { url: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!isHttpsImageUrl(url) || failed) {
    const className =
      'flex size-full items-center justify-center px-2 text-xs text-brand-600 hover:underline';
    if (failed && isHttpsImageUrl(url)) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
          {fallback}
        </a>
      );
    }
    return (
      <span className="flex size-full items-center justify-center px-2 text-xs text-brand-600">
        {fallback}
      </span>
    );
  }
  return (
    <img
      ref={(img) => {
        if (img?.complete && img.naturalWidth === 0) setFailed(true);
      }}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="size-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function toPickerItem(card: {
  slug: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
  seriesSlug: string;
  seriesTitle: string;
}): CardPickerItem {
  return {
    slug: card.slug,
    name: card.name,
    rarity: card.rarity,
    imageUrl: card.imageUrl,
    seriesSlug: card.seriesSlug,
    seriesTitle: card.seriesTitle,
  };
}

export const TradePublishPage = observer(function TradePublishPage() {
  const navigate = useNavigate();
  const { locale, session } = useStores();
  const [searchParams] = useSearchParams();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [kind, setKind] = useState<ListingKind>('SELL');
  const [selectedCard, setSelectedCard] = useState<CardPickerItem | null>(null);
  const [changingCard, setChangingCard] = useState(true);
  const [condition, setCondition] = useState<ListingCondition | undefined>();
  const [language, setLanguage] = useState<ListingLanguage | undefined>();
  const [variantNote, setVariantNote] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<TradeCurrency>('CNY');
  const [imageUrlsRaw, setImageUrlsRaw] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const cardInputRef = useRef<HTMLInputElement | null>(null);
  const priceRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLTextAreaElement | null>(null);
  const contactRef = useRef<HTMLInputElement | null>(null);
  const prefillSlug = searchParams.get('cardSlug') ?? '';
  const prefillQuery = trpc.cards.bySlug.useQuery(
    { slug: prefillSlug },
    { enabled: prefillSlug.length > 0, retry: false },
  );

  useEffect(() => {
    if (prefillQuery.data && !selectedCard) {
      setSelectedCard(toPickerItem(prefillQuery.data));
      setChangingCard(false);
    }
  }, [prefillQuery.data, selectedCard]);

  const utils = trpc.useUtils();
  const mutation = trpc.listings.publish.useMutation({
    onSuccess() {
      void utils.listings.list.invalidate();
      void utils.listings.byCard.invalidate();
      navigate('/trade', { replace: true });
    },
    onError(err) {
      setFormError(
        err.data?.code === 'TOO_MANY_REQUESTS' ? tt('trade.publish.rateLimited') : err.message,
      );
    },
  });

  if (!session.isAuthenticated) {
    return (
      <PageShell>
        <PageMeta title={tt('trade.publish.title')} />
        <div className="mx-auto max-w-md space-y-4">
          <Breadcrumbs
            items={[
              { label: tt('breadcrumb.home'), to: '/' },
              { label: tt('trade.list.title'), to: '/trade' },
              { label: tt('trade.publish.title') },
            ]}
          />
          <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600">
            <Link
              to="/login"
              state={{ from: '/trade/new' }}
              className="text-brand-600 hover:underline"
            >
              {tt('trade.list.loginToPublish')}
            </Link>
          </p>
        </div>
      </PageShell>
    );
  }

  const imageUrls = imageUrlsRaw
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const imageError =
    imageUrls.length > 4
      ? tt('trade.publish.error.tooManyImages')
      : imageUrls.some((url) => !url.toLowerCase().startsWith('https://'))
        ? tt('trade.publish.error.imageUrl')
        : undefined;

  function focusFirstError(errors: FieldErrors) {
    if (errors.card) cardInputRef.current?.focus();
    else if (errors.price) priceRef.current?.focus();
    else if (errors.imageUrls) imageRef.current?.focus();
    else if (errors.contact) contactRef.current?.focus();
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const errors: FieldErrors = {};
    if (!selectedCard) errors.card = tt('trade.publish.error.cardRequired');
    if (price.trim() && !Number.isFinite(Number(price.trim())))
      errors.price = tt('trade.publish.error.price');
    if (imageError) errors.imageUrls = imageError;
    if (contact.trim().length < 2 || contact.trim().length > 200)
      errors.contact = tt('trade.publish.error.contact');
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    const parsed = listingPublishInput.safeParse({
      cardSlug: selectedCard!.slug,
      kind,
      price: price.trim() ? price.trim() : undefined,
      currency,
      imageUrls,
      contact: contact.trim(),
      note: note.trim() ? note.trim() : undefined,
      condition,
      language,
      variantNote: variantNote.trim() ? variantNote.trim() : undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const mapped: FieldErrors = {};
      if (issue?.path[0] === 'imageUrls') mapped.imageUrls = tt(issue.message);
      else if (issue?.path[0] === 'price') mapped.price = tt('trade.publish.error.price');
      else if (issue?.path[0] === 'contact') mapped.contact = tt('trade.publish.error.contact');
      else mapped.card = tt('trade.publish.error.cardRequired');
      setFieldErrors(mapped);
      focusFirstError(mapped);
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data);
  };

  return (
    <PageShell>
      <PageMeta title={tt('trade.publish.title')} />
      <div className="mx-auto max-w-2xl space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('trade.list.title'), to: '/trade' },
            { label: tt('trade.publish.title') },
          ]}
        />
        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">{tt('trade.publish.title')}</CardTitle>
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {tt('trade.publish.disclaimer')}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <SegmentedControl
                legend={tt('trade.publish.kind')}
                name="publish-kind"
                value={kind}
                onValueChange={(value) => setKind(value as ListingKind)}
                options={LISTING_KIND_VALUES.map((value) => ({
                  value,
                  label: tt(value === 'SELL' ? 'trade.publish.kindSell' : 'trade.publish.kindBuy'),
                }))}
              />
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-600">
                  {tt('trade.publish.card')}
                </label>
                {prefillQuery.isLoading && !selectedCard ? (
                  <div className="flex items-center gap-3 rounded-md border border-neutral-300 bg-white p-3">
                    <div className="aspect-[63/88] w-16 animate-pulse rounded-sm bg-neutral-200" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-1/2 rounded bg-neutral-200" />
                      <div className="h-3 w-2/3 rounded bg-neutral-200" />
                    </div>
                  </div>
                ) : selectedCard && !changingCard ? (
                  <div className="flex items-center gap-3 rounded-md border border-neutral-300 bg-white p-3">
                    <CardThumb src={selectedCard.imageUrl} slug={selectedCard.slug} width="w-16" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{selectedCard.name}</p>
                      <p className="truncate text-xs text-neutral-600">
                        {selectedCard.seriesTitle}
                      </p>
                      {isKnownRarity(selectedCard.rarity) ? (
                        <RarityBadge rarity={selectedCard.rarity} locale={locale.locale} />
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setChangingCard(true);
                        setSelectedCard(null);
                        window.requestAnimationFrame(() => cardInputRef.current?.focus());
                      }}
                    >
                      {tt('trade.publish.cardChange')}
                    </Button>
                  </div>
                ) : (
                  <CardPicker
                    locale={locale.locale}
                    value={selectedCard}
                    onValueChange={(card) => {
                      setSelectedCard(card);
                      setChangingCard(false);
                    }}
                    id="trade-card"
                    ariaInvalid={Boolean(fieldErrors.card)}
                    ariaDescribedBy={fieldErrors.card ? 'trade-card-error' : undefined}
                    inputRef={cardInputRef}
                  />
                )}
                {prefillQuery.isError && !selectedCard ? (
                  <p className="text-xs text-red-700">{tt('trade.publish.cardNotFound')}</p>
                ) : null}
                {fieldErrors.card ? (
                  <p id="trade-card-error" className="text-xs text-red-700">
                    {fieldErrors.card}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label={tt('trade.condition.label')}
                  value={condition ?? 'none'}
                  onValueChange={(value) =>
                    setCondition(value === 'none' ? undefined : (value as ListingCondition))
                  }
                  options={[
                    { value: 'none', label: tt('trade.publish.notSpecified') },
                    ...LISTING_CONDITION_VALUES.map((value) => ({
                      value,
                      label: tt(`trade.condition.${value}`),
                    })),
                  ]}
                />
                <SelectField
                  label={tt('trade.language.label')}
                  value={language ?? 'none'}
                  onValueChange={(value) =>
                    setLanguage(value === 'none' ? undefined : (value as ListingLanguage))
                  }
                  options={[
                    { value: 'none', label: tt('trade.publish.notSpecified') },
                    ...LISTING_LANGUAGE_VALUES.map((value) => ({
                      value,
                      label: tt(`trade.language.${value}`),
                    })),
                  ]}
                />
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-600">
                  {tt('trade.publish.variantNote')}
                </span>
                <Input
                  value={variantNote}
                  onChange={(event) => setVariantNote(event.target.value)}
                  maxLength={40}
                  placeholder={tt('trade.publish.variantNotePlaceholder')}
                />
                <span className="block text-right text-xs text-neutral-500" aria-live="off">
                  {variantNote.length}/40
                </span>
              </label>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-neutral-600">
                    {tt('trade.publish.price')}
                  </span>
                  <Input
                    ref={priceRef}
                    inputMode="decimal"
                    value={price}
                    aria-invalid={Boolean(fieldErrors.price)}
                    aria-describedby={fieldErrors.price ? 'trade-price-error' : undefined}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                  {fieldErrors.price ? (
                    <p id="trade-price-error" className="text-xs text-red-700">
                      {fieldErrors.price}
                    </p>
                  ) : null}
                </label>
                <SelectField
                  label={tt('trade.publish.currency')}
                  value={currency}
                  onValueChange={(value) => setCurrency(value as TradeCurrency)}
                  options={TRADE_CURRENCY_VALUES.map((value) => ({ value, label: value }))}
                />
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-600">
                  {tt('trade.publish.imageUrls')}
                </span>
                <textarea
                  ref={imageRef}
                  value={imageUrlsRaw}
                  onChange={(event) => setImageUrlsRaw(event.target.value)}
                  rows={3}
                  placeholder={'https://...\nhttps://...'}
                  aria-invalid={Boolean(fieldErrors.imageUrls || imageError)}
                  aria-describedby="trade-images-hint trade-images-error"
                  className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 aria-invalid:border-red-600"
                />
                <p id="trade-images-hint" className="text-xs text-neutral-500">
                  {tt('trade.publish.imageUrlsHint')}
                </p>
                {fieldErrors.imageUrls || imageError ? (
                  <p id="trade-images-error" className="text-xs text-red-700">
                    {fieldErrors.imageUrls ?? imageError}
                  </p>
                ) : null}
                {imageUrls.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-medium text-neutral-600">
                      {tt('trade.publish.imagePreview')}
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {imageUrls.slice(0, 4).map((url, index) => (
                        <li
                          key={`${url}-${index}`}
                          className="size-16 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-black/5"
                        >
                          <PublishImagePreview
                            url={url}
                            fallback={tt('trade.list.photoFallback', { index: index + 1 })}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-600">
                  {tt('trade.publish.contact')}
                </span>
                <Input
                  ref={contactRef}
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.contact)}
                  aria-describedby={fieldErrors.contact ? 'trade-contact-error' : undefined}
                />
                {fieldErrors.contact ? (
                  <p id="trade-contact-error" className="text-xs text-red-700">
                    {fieldErrors.contact}
                  </p>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-neutral-600">
                  {tt('trade.publish.note')}
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={500}
                  className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                />
              </label>
              {formError ? (
                <p
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {formError}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button asChild variant="outline">
                  <Link to="/trade">{tt('trade.publish.cancel')}</Link>
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? tt('trade.publish.submitting') : tt('trade.publish.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});

function SelectField({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}
