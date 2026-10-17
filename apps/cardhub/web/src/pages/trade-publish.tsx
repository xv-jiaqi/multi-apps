import { observer } from 'mobx-react-lite';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { LISTING_KIND_VALUES, listingPublishInput, t, type ListingKind } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const TradePublishPage = observer(function TradePublishPage() {
  const navigate = useNavigate();
  const { locale, session } = useStores();
  const [searchParams] = useSearchParams();
  const tt = (key: string) => t(locale.locale, key);

  const [kind, setKind] = useState<ListingKind>('SELL');
  const [cardSlug, setCardSlug] = useState(searchParams.get('cardSlug') ?? '');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [imageUrlsRaw, setImageUrlsRaw] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const mutation = trpc.listings.publish.useMutation({
    onSuccess() {
      void utils.listings.list.invalidate();
      void utils.listings.byCard.invalidate();
      navigate('/trade', { replace: true });
    },
    onError(err) {
      setError(err.message);
    },
  });

  if (!session.isAuthenticated) {
    return (
      <PageShell>
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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const imageUrls = imageUrlsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const parsed = listingPublishInput.safeParse({
      cardSlug: cardSlug.trim(),
      kind,
      price: price.trim().length > 0 ? price.trim() : undefined,
      currency: currency.trim().length > 0 ? currency.trim() : 'CNY',
      imageUrls,
      contact: contact.trim(),
      note: note.trim().length > 0 ? note.trim() : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? tt('state.error'));
      return;
    }
    mutation.mutate(parsed.data);
  };

  return (
    <PageShell>
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
            <form onSubmit={onSubmit} className="space-y-4">
              <fieldset className="space-y-1 text-sm">
                <legend className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                  {tt('trade.publish.kind')}
                </legend>
                <div className="inline-flex overflow-hidden rounded-md border border-neutral-200">
                  {LISTING_KIND_VALUES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setKind(option)}
                      aria-pressed={kind === option}
                      className={`px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                        kind === option
                          ? 'bg-neutral-900 text-white'
                          : 'bg-white text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      {tt(option === 'SELL' ? 'trade.publish.kindSell' : 'trade.publish.kindBuy')}
                    </button>
                  ))}
                </div>
              </fieldset>

              <Field
                label={tt('trade.publish.cardSlug')}
                hint={tt('trade.publish.cardSlugHint')}
                value={cardSlug}
                onChange={setCardSlug}
                required
              />

              <div className="grid gap-4 sm:grid-cols-[1fr,8rem]">
                <Field
                  label={tt('trade.publish.price')}
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={setPrice}
                />
                <Field
                  label={tt('trade.publish.currency')}
                  value={currency}
                  onChange={(v) => setCurrency(v.toUpperCase())}
                  maxLength={3}
                />
              </div>

              <TextAreaField
                label={tt('trade.publish.imageUrls')}
                value={imageUrlsRaw}
                onChange={setImageUrlsRaw}
                rows={3}
                placeholder={'https://...\nhttps://...'}
              />

              <Field
                label={tt('trade.publish.contact')}
                value={contact}
                onChange={setContact}
                required
              />

              <TextAreaField
                label={tt('trade.publish.note')}
                value={note}
                onChange={setNote}
                rows={3}
                maxLength={500}
              />

              {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
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

interface FieldProps {
  label: string;
  hint?: string;
  type?: 'text' | 'email' | 'password';
  inputMode?: 'decimal' | 'text';
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  maxLength?: number;
}

function Field({
  label,
  hint,
  type = 'text',
  inputMode,
  value,
  onChange,
  required,
  maxLength,
}: FieldProps) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-base text-neutral-900 shadow-sm transition-shadow focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
      {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
    </label>
  );
}

interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  maxLength,
}: TextAreaFieldProps) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
    </label>
  );
}

export const useTradePublishPage = TradePublishPage;
