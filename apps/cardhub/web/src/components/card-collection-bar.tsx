import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Link, useLocation, useNavigate } from 'react-router';
import { Check } from 'lucide-react';
import { Button, Input } from '@repo/ui-web';
import { APP_ERROR_CODES, appErrorMessage, fieldErrorMessage, t, type Locale } from '@repo/shared';
import { dataErrorRetryClassName, ErrorBox } from './error-box';
import { queryFallback } from './retry-button';
import { isSessionInvalidError, subscribeSessionExpired } from '../lib/session-expiry';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

/** Whole numbers 0–99. Leading zeros and surrounding spaces stay invalid. */
const QUANTITY_PATTERN = /^(?:0|[1-9]\d?)$/;

const OWNED_COUNT_FIELD_CODES = new Set([
  'collection_quantity',
  'too_small',
  'too_big',
  'invalid_type',
]);

const PRESSED_CLASS =
  'border-brand-600 bg-brand-600 text-white hover:bg-brand-600 hover:text-white';

const FOCUS_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';

type Entry = { ownedCount: number; wanted: boolean };

type TextHint = { id: number; text: string };

type UpsertResult =
  | { outcome: 'saved'; item: { ownedCount: number; wanted: boolean } }
  | { outcome: 'removed'; cardSlug: string };

const EMPTY: Entry = { ownedCount: 0, wanted: false };

export type CollectionWriteFailure =
  | { kind: 'redirect'; text: string }
  | { kind: 'field'; text: string }
  | { kind: 'alert'; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readData(error: unknown): Record<string, unknown> | null {
  if (!isRecord(error) || !isRecord(error.data)) return null;
  return error.data;
}

function readAppCode(error: unknown): string | undefined {
  const appCode = readData(error)?.appCode;
  return typeof appCode === 'string' ? appCode : undefined;
}

function readTrpcCode(error: unknown): string | undefined {
  const code = readData(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

function readPath(error: unknown): string | undefined {
  const path = readData(error)?.path;
  return typeof path === 'string' ? path : undefined;
}

function pushSignal(signals: string[], value: unknown) {
  if (typeof value === 'string' && value.length > 0) signals.push(value);
}

/** Codes on an `ownedCount` issue. The API's top-level message is the generic validation sentence. */
function ownedCountSignals(error: unknown): string[] {
  const zodError = readData(error)?.zodError;
  if (!isRecord(zodError)) return [];
  const signals: string[] = [];
  if (Array.isArray(zodError.issues)) {
    for (const issue of zodError.issues) {
      if (!isRecord(issue)) continue;
      const path = Array.isArray(issue.path) ? issue.path : [];
      if (path[0] !== 'ownedCount') continue;
      pushSignal(signals, issue.message);
      pushSignal(signals, issue.code);
    }
  }
  const fieldErrors = zodError.fieldErrors;
  if (!isRecord(fieldErrors) || !Array.isArray(fieldErrors.ownedCount)) return signals;
  for (const item of fieldErrors.ownedCount) pushSignal(signals, item);
  return signals;
}

/**
 * Save-failure copy for the detail bar. An ownedCount `collection_quantity`
 * code (or the generic zod codes the spec still names) uses the field
 * sentence, never the server's generic validation message.
 */
export function collectionWriteFailure(locale: Locale, error: unknown): CollectionWriteFailure {
  if (isSessionInvalidError(error)) {
    return {
      kind: 'redirect',
      text: appErrorMessage(locale, APP_ERROR_CODES.UNAUTHORIZED),
    };
  }
  if (ownedCountSignals(error).some((code) => OWNED_COUNT_FIELD_CODES.has(code))) {
    return { kind: 'field', text: fieldErrorMessage(locale, 'collection_quantity') };
  }
  const appCode = readAppCode(error);
  const trpcCode = readTrpcCode(error);
  if (appCode === APP_ERROR_CODES.NOT_FOUND || trpcCode === 'NOT_FOUND') {
    return { kind: 'alert', text: appErrorMessage(locale, APP_ERROR_CODES.NOT_FOUND) };
  }
  if (appCode === APP_ERROR_CODES.TOO_MANY_REQUESTS || trpcCode === 'TOO_MANY_REQUESTS') {
    return { kind: 'alert', text: appErrorMessage(locale, APP_ERROR_CODES.TOO_MANY_REQUESTS) };
  }
  return { kind: 'alert', text: appErrorMessage(locale, appCode) };
}

function entryFromServer(data: { ownedCount: number; wanted: boolean } | null | undefined): Entry {
  if (!data) return EMPTY;
  return {
    ownedCount: data.ownedCount > 0 ? data.ownedCount : 0,
    wanted: data.wanted,
  };
}

function entryFromResult(result: UpsertResult): Entry {
  if (result.outcome === 'removed') return EMPTY;
  return entryFromServer(result.item);
}

function isUpsertResult(value: unknown): value is UpsertResult {
  if (!isRecord(value)) return false;
  if (value.outcome === 'removed' && typeof value.cardSlug === 'string') return true;
  if (value.outcome !== 'saved' || !isRecord(value.item)) return false;
  return typeof value.item.ownedCount === 'number' && typeof value.item.wanted === 'boolean';
}

function useTextHint() {
  const idRef = useRef(0);
  const [hint, setHint] = useState<TextHint | null>(null);
  const set = useCallback((text: string | null) => {
    if (text == null) {
      setHint(null);
      return;
    }
    idRef.current += 1;
    setHint({ id: idRef.current, text });
  }, []);
  return [hint, set] as const;
}

export const CardCollectionBar = observer(function CardCollectionBar({
  cardSlug,
  cardName,
}: {
  cardSlug: string;
  cardName: string;
}) {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const location = useLocation();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const authenticated = session.isAuthenticated;
  const quantityId = useId();
  const fieldErrorId = useId();
  const shareRef = useRef<HTMLButtonElement>(null);
  const from = `${location.pathname}${location.search}${location.hash}`;
  const fromRef = useRef(from);
  fromRef.current = from;

  const query = trpc.collection.byCard.useQuery(
    { cardSlug },
    { enabled: authenticated && cardSlug.length > 0 },
  );
  const utils = trpc.useUtils();
  const view = queryFallback(query);
  const sessionInvalid = isSessionInvalidError(query.error);
  const ready = authenticated && view === 'ready' && !sessionInvalid;
  // Loading stays focusable: `disabled` blurs the button the user is on.
  const loadLocked = authenticated && view === 'loading';
  const loadFailed = authenticated && view === 'error' && !sessionInvalid;

  const [entry, setEntry] = useState<Entry>(EMPTY);
  const [qtyText, setQtyText] = useState('');
  const [fieldError, setFieldError] = useTextHint();
  const [saveError, setSaveError] = useTextHint();
  const copyId = useRef(0);
  const [copyHint, setCopyHint] = useState<TextHint>({ id: 0, text: '' });
  const writeRef = useRef({
    queue: [] as Entry[],
    sending: false,
    baseline: EMPTY,
    slug: cardSlug,
  });
  writeRef.current.slug = cardSlug;

  const goLogin = () => {
    navigate('/login', { state: { from: fromRef.current } });
  };

  useEffect(() => {
    return subscribeSessionExpired((error) => {
      const path = readPath(error);
      if (path !== 'collection.byCard' && path !== 'collection.upsert') return;
      navigate('/login', { state: { from: fromRef.current } });
    });
  }, [navigate]);

  useEffect(() => {
    if (!sessionInvalid) return;
    navigate('/login', { state: { from: fromRef.current } });
  }, [navigate, sessionInvalid]);

  useEffect(() => {
    writeRef.current.queue = [];
    writeRef.current.sending = false;
    setFieldError(null);
    setSaveError(null);
    copyId.current += 1;
    setCopyHint({ id: copyId.current, text: '' });
  }, [cardSlug, setFieldError, setSaveError]);

  useEffect(() => {
    if (writeRef.current.sending || writeRef.current.queue.length > 0) return;
    const next = ready ? entryFromServer(query.data) : EMPTY;
    writeRef.current.baseline = next;
    setEntry(next);
  }, [cardSlug, query.data, ready]);

  useEffect(() => {
    if (entry.ownedCount > 0) setQtyText(String(entry.ownedCount));
  }, [cardSlug, entry.ownedCount]);

  const copiedLabel = tt('collection.copied');
  useEffect(() => {
    if (copyHint.text !== copiedLabel) return;
    const id = copyHint.id;
    const timer = window.setTimeout(() => {
      setCopyHint((current) => (current.id === id ? { id: current.id, text: '' } : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [copiedLabel, copyHint.id, copyHint.text]);

  const mutation = trpc.collection.upsert.useMutation();
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;
  const localeRef = useRef(locale.locale);
  localeRef.current = locale.locale;

  const publishCache = (slug: string, next: Entry) => {
    const cache = utils.collection?.byCard;
    if (!cache) return;
    cache.setData({ cardSlug: slug }, next.ownedCount === 0 && !next.wanted ? null : next);
  };

  const showWriteFailure = (error: unknown) => {
    const failure = collectionWriteFailure(localeRef.current, error);
    if (failure.kind === 'redirect') {
      setSaveError(failure.text);
      goLogin();
      return;
    }
    if (failure.kind === 'field') {
      setFieldError(failure.text);
      return;
    }
    setSaveError(failure.text);
  };

  const drain = () => {
    const write = writeRef.current;
    if (write.sending) return;
    const next = write.queue.shift();
    if (!next) return;
    const slugAtSend = write.slug;
    write.sending = true;
    mutateRef.current(
      { cardSlug: slugAtSend, ownedCount: next.ownedCount, wanted: next.wanted },
      {
        onSuccess(result) {
          if (slugAtSend !== writeRef.current.slug) return;
          writeRef.current.sending = false;
          if (!isUpsertResult(result)) {
            setEntry(writeRef.current.baseline);
            setSaveError(appErrorMessage(localeRef.current, APP_ERROR_CODES.UNKNOWN));
            writeRef.current.queue = [];
            return;
          }
          const reconciled = entryFromResult(result);
          writeRef.current.baseline = reconciled;
          publishCache(slugAtSend, reconciled);
          if (writeRef.current.queue.length === 0) setEntry(reconciled);
          drain();
        },
        onError(error) {
          if (slugAtSend !== writeRef.current.slug) return;
          writeRef.current.sending = false;
          writeRef.current.queue = [];
          setEntry(writeRef.current.baseline);
          showWriteFailure(error);
        },
      },
    );
  };

  const apply = (next: Entry) => {
    setEntry(next);
    setFieldError(null);
    setSaveError(null);
    writeRef.current.queue.push(next);
    drain();
  };

  const ownPressed = ready && entry.ownedCount > 0;
  const wantPressed = ready && entry.wanted;
  const showQuantity = ownPressed;

  const onOwn = () => {
    if (loadLocked) return;
    if (!authenticated) {
      goLogin();
      return;
    }
    if (!ready) return;
    apply({ ownedCount: ownPressed ? 0 : 1, wanted: entry.wanted });
  };

  const onWant = () => {
    if (loadLocked) return;
    if (!authenticated) {
      goLogin();
      return;
    }
    if (!ready) return;
    apply({ ownedCount: entry.ownedCount, wanted: !entry.wanted });
  };

  const commitQuantity = () => {
    if (!QUANTITY_PATTERN.test(qtyText)) {
      setFieldError(fieldErrorMessage(locale.locale, 'collection_quantity'));
      return;
    }
    const ownedCount = Number(qtyText);
    setFieldError(null);
    if (ownedCount === entry.ownedCount) return;
    apply({ ownedCount, wanted: entry.wanted });
  };

  const setCopy = (text: string) => {
    copyId.current += 1;
    setCopyHint({ id: copyId.current, text });
  };

  const share = async () => {
    const url = window.location.href;
    const nav = navigator;
    let shared = false;
    if (typeof nav.share === 'function' && typeof nav.canShare === 'function') {
      try {
        shared = nav.canShare({ url });
      } catch {
        shared = false;
      }
    }
    if (shared && typeof nav.share === 'function') {
      try {
        await nav.share({ title: cardName, text: cardName, url });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setCopy(tt('collection.copyFailed'));
      } finally {
        shareRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopy(tt('collection.copied'));
    } catch {
      setCopy(tt('collection.copyFailed'));
    } finally {
      shareRef.current?.focus({ preventScroll: true });
    }
  };

  const loginLabel = tt('auth.login.title');
  const hint = tt('collection.signInHint');
  const hintAt = hint.indexOf(loginLabel);
  const unauthorized = appErrorMessage(locale.locale, APP_ERROR_CODES.UNAUTHORIZED);

  return (
    <section aria-labelledby="collection-title" className="min-w-0">
      <h2 id="collection-title" className="sr-only">
        {tt('collection.title')}
      </h2>
      <div className="grid min-w-0 grid-cols-2 items-center gap-3 md:flex md:flex-wrap">
        <div key="own" className="relative min-w-0 w-full md:w-auto">
          <Button
            type="button"
            variant="outline"
            size="default"
            aria-pressed={ownPressed}
            disabled={loadFailed}
            aria-disabled={loadLocked || undefined}
            onClick={onOwn}
            className={`w-full transition-none md:w-auto ${ownPressed ? PRESSED_CLASS : ''}`}
          >
            {ownPressed ? <Check aria-hidden="true" className="size-4" /> : null}
            {tt('collection.own')}
          </Button>
          {view === 'loading' && authenticated ? <ToggleSkeleton /> : null}
        </div>
        {showQuantity ? (
          <div key="quantity" className="flex min-w-0 items-center gap-2">
            <label htmlFor={quantityId} className="min-w-0 text-sm text-neutral-600 wrap-anywhere">
              {tt('collection.quantity')}
            </label>
            <Input
              id={quantityId}
              type="text"
              inputMode="numeric"
              value={qtyText}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? fieldErrorId : undefined}
              onChange={(event) => setQtyText(event.target.value)}
              onBlur={commitQuantity}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitQuantity();
              }}
              className="h-10 w-16 border-neutral-500 text-center"
            />
          </div>
        ) : (
          <div key="quantity" className="md:hidden" aria-hidden="true" />
        )}
        <div key="want" className="relative min-w-0 w-full md:w-auto">
          <Button
            type="button"
            variant="outline"
            size="default"
            aria-pressed={wantPressed}
            disabled={loadFailed}
            aria-disabled={loadLocked || undefined}
            onClick={onWant}
            className={`w-full transition-none md:w-auto ${wantPressed ? PRESSED_CLASS : ''}`}
          >
            {wantPressed ? <Check aria-hidden="true" className="size-4" /> : null}
            {tt('collection.want')}
          </Button>
          {view === 'loading' && authenticated ? <ToggleSkeleton /> : null}
        </div>
        <Button
          key="share"
          ref={shareRef}
          type="button"
          variant="ghost"
          onClick={() => {
            void share();
          }}
          className="w-full md:ms-auto md:w-auto"
        >
          {tt('collection.share')}
        </Button>
      </div>
      {authenticated ? null : (
        <p className="mt-3 min-w-0 text-sm text-neutral-600 wrap-anywhere">
          {hintAt < 0 ? (
            hint
          ) : (
            <>
              {hint.slice(0, hintAt)}
              <Link
                to="/login"
                state={{ from }}
                className={`inline-flex min-h-6 items-center text-brand-600 underline ${FOCUS_CLASS}`}
              >
                {loginLabel}
              </Link>
              {hint.slice(hintAt + loginLabel.length)}
            </>
          )}
        </p>
      )}
      <p
        role="status"
        className={
          copyHint.text ? 'mt-3 min-w-0 text-sm text-neutral-600 wrap-anywhere' : 'sr-only'
        }
      >
        <span key={copyHint.id}>{copyHint.text}</span>
      </p>
      {fieldError ? (
        <p
          key={fieldError.id}
          id={fieldErrorId}
          className="mt-3 min-w-0 text-sm text-red-700 wrap-anywhere"
        >
          {fieldError.text}
        </p>
      ) : null}
      {sessionInvalid && authenticated ? (
        <div className="mt-3">
          <ErrorBox title={unauthorized} />
        </div>
      ) : null}
      {saveError ? (
        <div key={saveError.id} className="mt-3">
          <ErrorBox title={saveError.text} />
        </div>
      ) : null}
      {loadFailed ? (
        <div className="mt-3">
          <ErrorBox
            title={tt('collection.statusLoadFailed')}
            retryLabel={tt('collection.retry')}
            retryingLabel={tt('state.retrying')}
            retrying={query.isFetching}
            retry={() => {
              void query.refetch();
            }}
            retryClassName={`${dataErrorRetryClassName} h-10 ring-offset-2`}
          />
        </div>
      ) : null}
    </section>
  );
});

function ToggleSkeleton() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-10 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none"
    />
  );
}
