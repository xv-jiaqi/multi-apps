import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { Button, Input, Picker, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { BreadcrumbsMini, Link, PrimaryButton, Skeleton } from '@repo/ui-mini';
import {
  APP_ERROR_CODES,
  LISTING_CONDITION_VALUES,
  LISTING_IMAGE_MAX_COUNT,
  LISTING_IMAGE_URL_MAX,
  LISTING_LANGUAGE_VALUES,
  LISTING_PRICE_STRING_MAX,
  TRADE_CURRENCY_VALUES,
  listingPublishInput,
  t,
  type ListingCondition,
  type ListingKind,
  type ListingLanguage,
  type TradeCurrency,
} from '@repo/shared';
import { trpc } from '../../../lib/trpc';
import { useStores } from '../../../stores/root-store';
import { mutationErrorMessage, readTrpcErrorCodes } from '../../../lib/load-error';
import { goLoginIfUnauthorized, goToLogin } from '../../../lib/auth-redirect';
import { nextNoticeId, type Notice } from '../../../lib/notice';
import { usePendingSubmit } from '../../../lib/use-pending-submit';
import { ArtworkMini } from '../../../components/artwork-mini';
import { ErrorBoxMini } from '../../../components/error-box-mini';
import './index.scss';

type SearchHit = Awaited<ReturnType<typeof trpc.cards.search.query>>['results'][number];
type SelectedCard = { slug: string; name: string; imageUrl: string | null; seriesTitle: string };

type FieldErrors = {
  card?: string;
  price?: string;
  currency?: string;
  condition?: string;
  language?: string;
  imageUrls?: string;
  contact?: string;
};

const CONDITION_OPTIONS: Array<ListingCondition | ''> = ['', ...LISTING_CONDITION_VALUES];
const LANGUAGE_OPTIONS: Array<ListingLanguage | ''> = ['', ...LISTING_LANGUAGE_VALUES];

function parseImageLines(raw: string): { urls: string[]; errorKey?: string } {
  const urls = raw
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (urls.length > LISTING_IMAGE_MAX_COUNT)
    return { urls, errorKey: 'trade.publish.error.tooManyImages' };
  if (urls.some((url) => url.length > LISTING_IMAGE_URL_MAX)) {
    return { urls, errorKey: 'trade.publish.error.imageTooLong' };
  }
  if (urls.some((url) => !url.toLowerCase().startsWith('https://'))) {
    return { urls, errorKey: 'trade.publish.error.imageUrl' };
  }
  return { urls };
}

export default observer(function TradePublishPage() {
  const router = useRouter();
  const prefillSlug = (router.params.cardSlug ?? '').toString();
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);

  const [kind, setKind] = useState<ListingKind>('SELL');
  const [cardQuery, setCardQuery] = useState('');
  const [cardHits, setCardHits] = useState<SearchHit[]>([]);
  const [cardSearching, setCardSearching] = useState(false);
  const [cardSearchFailed, setCardSearchFailed] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<TradeCurrency>('CNY');
  const [condition, setCondition] = useState<ListingCondition | ''>('');
  const [language, setLanguage] = useState<ListingLanguage | ''>('');
  const [variantNote, setVariantNote] = useState('');
  const [contact, setContact] = useState('');
  const [imageText, setImageText] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<Notice<{ text: string }> | null>(null);
  const [prefillFailed, setPrefillFailed] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(Boolean(prefillSlug));
  const submit = usePendingSubmit();

  useDidShow(() => {
    void Taro.setNavigationBarTitle({ title: tt('trade.publish.title') });
    if (!session.isAuthenticated) goToLogin();
  });

  useEffect(() => {
    if (!prefillSlug) return;
    let cancelled = false;
    setPrefillLoading(true);
    setPrefillFailed(false);
    void trpc.cards.bySlug
      .query({ slug: prefillSlug })
      .then((card) => {
        if (cancelled) return;
        setSelectedCard({
          slug: card.slug,
          name: card.name,
          imageUrl: card.imageUrl,
          seriesTitle: card.seriesTitle,
        });
      })
      .catch(() => {
        if (!cancelled) setPrefillFailed(true);
      })
      .finally(() => {
        if (!cancelled) setPrefillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prefillSlug]);

  useEffect(() => {
    const q = cardQuery.trim();
    if (selectedCard || q.length === 0) {
      setCardHits([]);
      setCardSearching(false);
      setCardSearchFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setCardSearching(true);
      setCardSearchFailed(false);
      void trpc.cards.search
        .query({ q, limit: 20 })
        .then((res) => {
          if (cancelled) return;
          setCardHits(res.results);
        })
        .catch(() => {
          if (!cancelled) setCardSearchFailed(true);
        })
        .finally(() => {
          if (!cancelled) setCardSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cardQuery, selectedCard, searchNonce]);

  const showFormError = (text: string) => setFormError({ id: nextNoticeId(), text });

  const publish = async () => {
    if (submit.pending) return;
    setFormError(null);
    const images = parseImageLines(imageText);
    const errors: FieldErrors = {};
    if (!selectedCard) errors.card = tt('trade.publish.error.cardRequired');
    const priceTrimmed = price.trim();
    if (priceTrimmed) {
      if (priceTrimmed.length > LISTING_PRICE_STRING_MAX) {
        errors.price = tt('trade.publish.error.priceTooLong');
      }
    }
    if (images.errorKey) errors.imageUrls = tt(images.errorKey);
    if (contact.trim().length < 2 || contact.trim().length > 200) {
      errors.contact = tt('trade.publish.error.contact');
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    if (!session.isAuthenticated) {
      goToLogin();
      return;
    }
    const parsed = listingPublishInput.safeParse({
      cardSlug: selectedCard!.slug,
      kind,
      price: priceTrimmed ? priceTrimmed : undefined,
      currency,
      imageUrls: images.urls,
      contact: contact.trim(),
      condition: condition || undefined,
      language: language || undefined,
      variantNote: variantNote.trim() || undefined,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path[0];
      const mapped: FieldErrors = {};
      if (path === 'price') {
        mapped.price =
          issue?.message === 'price_range'
            ? tt('trade.publish.error.price')
            : tt('trade.publish.error.priceTooLong');
      } else if (path === 'imageUrls') {
        mapped.imageUrls =
          issue?.message === 'image_too_many'
            ? tt('trade.publish.error.tooManyImages')
            : issue?.message === 'image_https'
              ? tt('trade.publish.error.imageUrl')
              : tt('trade.publish.error.imageTooLong');
      } else if (path === 'contact') mapped.contact = tt('trade.publish.error.contact');
      else if (path === 'cardSlug') mapped.card = tt('trade.publish.error.cardRequired');
      else showFormError(tt('error.app.UNKNOWN'));
      setFieldErrors(mapped);
      return;
    }
    if (!submit.begin()) return;
    try {
      await trpc.listings.publish.mutate(parsed.data);
      // Trade list is a tab page: WeChat rejects redirectTo onto a tab.
      // switchTab also pops the publish page, which is the intent of §1.
      void Taro.switchTab({ url: '/pages/trade/list/index' });
    } catch (error) {
      if (goLoginIfUnauthorized(error)) return;
      const codes = readTrpcErrorCodes(error);
      if (codes.code === 'NOT_FOUND' || codes.appCode === 'NOT_FOUND') {
        setFieldErrors({ card: tt('trade.publish.cardNotFound') });
        return;
      }
      showFormError(
        mutationErrorMessage({
          locale: locale.locale,
          error,
          copy: {
            [APP_ERROR_CODES.CONTENT_BLOCKED]: tt('content.blocked'),
            [APP_ERROR_CODES.TOO_MANY_REQUESTS]: tt('trade.publish.rateLimited'),
          },
        }),
      );
    } finally {
      submit.end();
    }
  };

  const conditionLabels = CONDITION_OPTIONS.map((value) =>
    value ? tt(`trade.condition.${value}`) : tt('trade.publish.notSpecified'),
  );
  const languageLabels = LANGUAGE_OPTIONS.map((value) =>
    value ? tt(`trade.language.${value}`) : tt('trade.publish.notSpecified'),
  );
  const currencyLabels = TRADE_CURRENCY_VALUES.map((value) => value);

  return (
    <ScrollView scrollY className="trade-page">
      <View className="trade-page__body">
        <BreadcrumbsMini
          items={[
            { label: tt('breadcrumb.home'), to: '/pages/index/index', mode: 'switchTab' },
            { label: tt('trade.list.title'), to: '/pages/trade/list/index', mode: 'switchTab' },
            { label: tt('trade.publish.title') },
          ]}
        />

        {session.isAuthenticated ? (
          <View>
            <Text className="trade-page__title">{tt('trade.publish.title')}</Text>
            <View className="trade-page__disclaimer">
              <Text className="trade-page__disclaimer-text">{tt('trade.publish.disclaimer')}</Text>
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.publish.kind')}</Text>
              <View className="trade-kind">
                <Button
                  className={`trade-kind__btn${kind === 'SELL' ? ' trade-kind__btn--active' : ''}`}
                  hoverClass="none"
                  onClick={() => setKind('SELL')}
                >
                  {tt('trade.publish.kindSell')}
                </Button>
                <Button
                  className={`trade-kind__btn${kind === 'BUY' ? ' trade-kind__btn--active' : ''}`}
                  hoverClass="none"
                  onClick={() => setKind('BUY')}
                >
                  {tt('trade.publish.kindBuy')}
                </Button>
              </View>
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.publish.card')}</Text>
              {prefillLoading ? <Skeleton /> : null}
              {selectedCard ? (
                <View className="trade-card-preview">
                  <View className="trade-card-preview__thumb">
                    <ArtworkMini
                      src={selectedCard.imageUrl}
                      slug={selectedCard.slug}
                      ratio="card"
                      mode="aspectFill"
                      label={selectedCard.name}
                    />
                  </View>
                  <View className="trade-card-preview__text">
                    <Text className="trade-card-preview__name">{selectedCard.name}</Text>
                    <Text className="trade-card-preview__series">{selectedCard.seriesTitle}</Text>
                  </View>
                  <Text
                    className="trade-card-preview__change"
                    onClick={() => {
                      setSelectedCard(null);
                      setCardQuery('');
                    }}
                  >
                    {tt('trade.publish.cardChange')}
                  </Text>
                </View>
              ) : (
                <View>
                  <Input
                    className={`trade-form__input${fieldErrors.card ? ' trade-form__input--error' : ''}`}
                    value={cardQuery}
                    placeholder={tt('trade.publish.cardPlaceholder')}
                    disabled={submit.pending ? true : undefined}
                    onInput={(event) => setCardQuery(event.detail.value)}
                  />
                  {cardSearching ? (
                    <Text className="trade-form__hint">{tt('state.loading')}</Text>
                  ) : null}
                  {cardSearchFailed ? (
                    <ErrorBoxMini
                      title={tt('form.searchFailed')}
                      retryLabel={tt('state.retry')}
                      retryingLabel={tt('state.retrying')}
                      retrying={cardSearching}
                      onRetry={() => setSearchNonce((n) => n + 1)}
                    />
                  ) : null}
                  {cardHits.map((hit) => (
                    <View
                      key={hit.slug}
                      className="trade-search-hit"
                      onClick={() => {
                        setSelectedCard({
                          slug: hit.slug,
                          name: hit.name,
                          imageUrl: hit.imageUrl,
                          seriesTitle: hit.seriesTitle,
                        });
                        setCardQuery('');
                        setFieldErrors((current) => ({ ...current, card: undefined }));
                      }}
                    >
                      <View className="trade-search-hit__thumb">
                        <ArtworkMini
                          src={hit.imageUrl}
                          slug={hit.slug}
                          ratio="card"
                          mode="aspectFill"
                          label={hit.name}
                        />
                      </View>
                      <Text className="trade-search-hit__text">
                        {hit.name}
                        {hit.seriesTitle ? ` · ${hit.seriesTitle}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              {fieldErrors.card ? (
                <Text className="trade-select__error">{fieldErrors.card}</Text>
              ) : null}
              {prefillFailed ? (
                <Text className="trade-select__error">{tt('trade.publish.cardNotFound')}</Text>
              ) : null}
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.publish.price')}</Text>
              <Input
                className={`trade-form__input${fieldErrors.price ? ' trade-form__input--error' : ''}`}
                value={price}
                type="digit"
                disabled={submit.pending ? true : undefined}
                onInput={(event) => setPrice(event.detail.value)}
              />
              {fieldErrors.price ? (
                <Text className="trade-select__error">{fieldErrors.price}</Text>
              ) : null}
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.publish.currency')}</Text>
              <Picker
                mode="selector"
                range={currencyLabels}
                value={TRADE_CURRENCY_VALUES.indexOf(currency)}
                onChange={(event) => {
                  const next = TRADE_CURRENCY_VALUES[Number(event.detail.value)];
                  if (next) setCurrency(next);
                }}
              >
                <View
                  className={`trade-select${fieldErrors.currency ? ' trade-select--error' : ''}`}
                >
                  <Text>{currency}</Text>
                </View>
              </Picker>
              {fieldErrors.currency ? (
                <Text className="trade-select__error">{fieldErrors.currency}</Text>
              ) : null}
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.condition.label')}</Text>
              <Picker
                mode="selector"
                range={conditionLabels}
                value={CONDITION_OPTIONS.indexOf(condition)}
                onChange={(event) => {
                  setCondition(CONDITION_OPTIONS[Number(event.detail.value)] ?? '');
                }}
              >
                <View
                  className={`trade-select${fieldErrors.condition ? ' trade-select--error' : ''}`}
                >
                  <Text>
                    {condition
                      ? tt(`trade.condition.${condition}`)
                      : tt('trade.publish.notSpecified')}
                  </Text>
                </View>
              </Picker>
              {fieldErrors.condition ? (
                <Text className="trade-select__error">{fieldErrors.condition}</Text>
              ) : null}
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.language.label')}</Text>
              <Picker
                mode="selector"
                range={languageLabels}
                value={LANGUAGE_OPTIONS.indexOf(language)}
                onChange={(event) => {
                  setLanguage(LANGUAGE_OPTIONS[Number(event.detail.value)] ?? '');
                }}
              >
                <View
                  className={`trade-select${fieldErrors.language ? ' trade-select--error' : ''}`}
                >
                  <Text>
                    {language ? tt(`trade.language.${language}`) : tt('trade.publish.notSpecified')}
                  </Text>
                </View>
              </Picker>
              {fieldErrors.language ? (
                <Text className="trade-select__error">{fieldErrors.language}</Text>
              ) : null}
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.publish.variantNote')}</Text>
              <Input
                className="trade-form__input"
                value={variantNote}
                placeholder={tt('trade.publish.variantNotePlaceholder')}
                maxlength={40}
                disabled={submit.pending ? true : undefined}
                onInput={(event) => setVariantNote(event.detail.value)}
              />
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.publish.contact')}</Text>
              <Input
                className={`trade-form__input${fieldErrors.contact ? ' trade-form__input--error' : ''}`}
                value={contact}
                maxlength={200}
                disabled={submit.pending ? true : undefined}
                onInput={(event) => setContact(event.detail.value)}
              />
              <Text className="trade-form__hint">{tt('trade.publish.contactHintSignedIn')}</Text>
              {fieldErrors.contact ? (
                <Text className="trade-select__error">{fieldErrors.contact}</Text>
              ) : null}
            </View>

            <View className="trade-form__section">
              <Text className="trade-form__label">{tt('trade.publish.imageUrls')}</Text>
              <Textarea
                className={`trade-form__textarea${fieldErrors.imageUrls ? ' trade-form__textarea--error' : ''}`}
                value={imageText}
                placeholder={tt('trade.publish.imageUrlsHint')}
                disabled={submit.pending ? true : undefined}
                onInput={(event) => setImageText(event.detail.value)}
              />
              {fieldErrors.imageUrls ? (
                <Text className="trade-select__error">{fieldErrors.imageUrls}</Text>
              ) : null}
            </View>

            {formError ? (
              <View key={formError.id} className="trade-form__error" ariaRole="alert">
                <Text className="trade-form__error-text">{formError.text}</Text>
              </View>
            ) : null}

            <View className="trade-form__footer">
              <PrimaryButton
                label={submit.pending ? tt('trade.publish.submitting') : tt('trade.publish.submit')}
                disabled={submit.pending}
                onClick={() => void publish()}
              />
            </View>

            <Link to="/pages/trade/list/index" mode="back" className="trade-form__cancel">
              <Text>{tt('trade.publish.cancel')}</Text>
            </Link>
          </View>
        ) : (
          <View className="trade-login" onClick={goToLogin}>
            <Text>{tt('trade.list.loginToPublish')}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
});
