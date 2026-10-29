import { describe, expect, it } from 'vitest';
import { utf8ByteLength } from '../catalog-import';
import {
  ADMIN_ATTRIBUTE_KEY_MAX,
  ADMIN_ATTRIBUTE_MAX_KEYS,
  ADMIN_ATTRIBUTE_VALUE_MAX,
  AUTH_TOKEN_MAX,
  CURSOR_MAX,
  EMAIL_MAX,
  LISTING_IMAGE_MAX_COUNT,
  LISTING_IMAGE_URL_MAX,
  LISTING_PRICE_STRING_MAX,
  COLLECTION_OWNED_COUNT_MAX,
  COLLECTION_OWNED_COUNT_MIN,
  adminCardUpsertInput,
  adminSeriesUpsertInput,
  adminSubsetUpsertInput,
  authTokenSchema,
  collectionUpsertInput,
  cursorPaginationInput,
  emailSchema,
  listingPublishInput,
  pageCursorPaginationInput,
  topicCreateInput,
} from './index';

/** Nest's default `express.json({ limit: '100kb' })`, in bytes. */
const JSON_BODY_LIMIT = 100 * 1024;

function cjk(length: number) {
  return '测'.repeat(length);
}

function httpsUrl(length: number) {
  const prefix = 'https://img.cardhub.test/';
  return prefix + 'a'.repeat(length - prefix.length);
}

function attributeKey(index: number) {
  const suffix = String(index).padStart(2, '0');
  return `${cjk(ADMIN_ATTRIBUTE_KEY_MAX - suffix.length)}${suffix}`;
}

function expectUnderBodyLimit(label: string, value: unknown) {
  const bytes = utf8ByteLength(JSON.stringify(value));
  expect(bytes, label).toBeLessThan(JSON_BODY_LIMIT);
  return bytes;
}

describe('procedure input upper bounds', () => {
  it('accepts a max-length email and rejects one more character', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(59)}.com`;
    expect(email).toHaveLength(EMAIL_MAX);
    expect(emailSchema.safeParse(email).success).toBe(true);
    expect(emailSchema.safeParse(`${email}x`).success).toBe(false);
  });

  it('keeps the largest accepted procedure bodies under 100kb', () => {
    const publish = {
      cardSlug: 'a'.repeat(64),
      kind: 'SELL' as const,
      price: '0'.repeat(LISTING_PRICE_STRING_MAX),
      currency: 'CNY',
      imageUrls: Array.from({ length: LISTING_IMAGE_MAX_COUNT }, () =>
        httpsUrl(LISTING_IMAGE_URL_MAX),
      ),
      contact: cjk(200),
      note: cjk(500),
      variantNote: cjk(40),
    };
    expect(listingPublishInput.safeParse(publish).success).toBe(true);
    expectUnderBodyLimit('listings.publish', publish);

    const card = {
      slug: 'a'.repeat(64),
      name: cjk(120),
      description: cjk(5000),
      rarity: 'legendary' as const,
      imageUrl: httpsUrl(LISTING_IMAGE_URL_MAX),
      attributes: Object.fromEntries(
        Array.from({ length: ADMIN_ATTRIBUTE_MAX_KEYS }, (_, index) => [
          attributeKey(index),
          cjk(ADMIN_ATTRIBUTE_VALUE_MAX),
        ]),
      ),
      seriesSlug: 'b'.repeat(64),
    };
    expect(adminCardUpsertInput.safeParse(card).success).toBe(true);
    expectUnderBodyLimit('admin.cards.create', card);

    const series = {
      slug: 'a'.repeat(64),
      title: cjk(120),
      description: cjk(5000),
      coverUrl: httpsUrl(LISTING_IMAGE_URL_MAX),
    };
    expect(adminSeriesUpsertInput.safeParse(series).success).toBe(true);
    expectUnderBodyLimit('admin.series.create', series);

    const subset = {
      seriesSlug: 'celestial-dawn',
      slug: 'base',
      name: '主卡',
      kind: 'BASE' as const,
      description: cjk(5000),
    };
    expect(adminSubsetUpsertInput.safeParse(subset).success).toBe(true);
    const overlongSubset = adminSubsetUpsertInput.safeParse({
      ...subset,
      description: cjk(5001),
    });
    expect(overlongSubset.success).toBe(false);
    if (!overlongSubset.success) {
      expect(overlongSubset.error.issues[0]?.path).toEqual(['description']);
      expect(overlongSubset.error.issues[0]?.message).toBe('description_too_long');
    }
    const overlongSeries = adminSeriesUpsertInput.safeParse({
      slug: 'a',
      title: '标题',
      description: cjk(5001),
    });
    expect(overlongSeries.success).toBe(false);
    if (!overlongSeries.success) {
      expect(overlongSeries.error.issues[0]?.message).not.toBe('description_too_long');
    }

    const topic = { title: cjk(120), body: cjk(10_000) };
    expect(topicCreateInput.safeParse(topic).success).toBe(true);
    expectUnderBodyLimit('forum.topics.create', topic);

    const token = 'a'.repeat(AUTH_TOKEN_MAX);
    expect(authTokenSchema.safeParse(token).success).toBe(true);
    expect(authTokenSchema.safeParse(`${token}a`).success).toBe(false);
    expectUnderBodyLimit('auth.me', { token });

    const cursor = 'a'.repeat(CURSOR_MAX);
    expect(cursorPaginationInput.safeParse({ cursor }).success).toBe(true);
    expect(cursorPaginationInput.safeParse({ cursor: `${cursor}a` }).success).toBe(false);
    expect(pageCursorPaginationInput.safeParse({ pageCursor: cursor, cursor }).success).toBe(true);
    expectUnderBodyLimit('cursor page', { cursor, pageCursor: cursor, limit: 50 });

    expect(COLLECTION_OWNED_COUNT_MIN).toBe(0);
    expect(COLLECTION_OWNED_COUNT_MAX).toBe(99);
    expect(
      collectionUpsertInput.safeParse({ cardSlug: 'alpha', ownedCount: 0, wanted: true }).success,
    ).toBe(true);
    expect(
      collectionUpsertInput.safeParse({ cardSlug: 'alpha', ownedCount: 99, wanted: false }).success,
    ).toBe(true);
    for (const ownedCount of [-1, 100, 1.5, '2', null]) {
      const parsed = collectionUpsertInput.safeParse({
        cardSlug: 'alpha',
        ownedCount,
        wanted: false,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((issue) => issue.path[0] === 'ownedCount')).toBe(true);
      }
    }
    expect(
      collectionUpsertInput.safeParse({ cardSlug: 'alpha', ownedCount: 1, wanted: 'yes' }).success,
    ).toBe(false);
  });
});
