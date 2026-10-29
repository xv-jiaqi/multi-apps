import { z } from 'zod';

export const RARITY_VALUES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITY_VALUES)[number];

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_format');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// Identity primitives reused by web / native / miniapp clients so the
// "is this username allowed" rule lives in exactly one place. The regex
// allows letters, digits, underscores and hyphens — it is intentionally
// stricter than a slug so usernames stay readable in @mentions.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'username_too_short')
  .max(24, 'username_too_long')
  .regex(/^[A-Za-z0-9_-]+$/, 'username_format');

/** Same cap as the login identifier, so a registered email can be used to sign in. */
export const EMAIL_MAX = 128;

export const emailSchema = z
  .string()
  .trim()
  .max(EMAIL_MAX, 'email_too_long')
  .toLowerCase()
  .email('email_format');

export const passwordSchema = z.string().min(8, 'password_too_short').max(128, 'password_too_long');

export const registerInput = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const loginInput = z.object({
  identifier: z.string().trim().min(3, 'identifier_too_short').max(128, 'identifier_too_long'),
  password: passwordSchema,
});

export const changePasswordInput = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

export type ChangePasswordInput = z.infer<typeof changePasswordInput>;

export type RegisterInput = z.infer<typeof registerInput>;
export type LoginInput = z.infer<typeof loginInput>;

export const commentContentSchema = z
  .string()
  .trim()
  .min(1, 'comment_required')
  .max(500, 'comment_too_long');

export const commentInput = z.object({
  cardSlug: slugSchema,
  content: commentContentSchema,
  parentId: z.string().uuid().optional(),
});
export type CommentInput = z.infer<typeof commentInput>;

export const seriesCommentInput = z.object({
  seriesSlug: slugSchema,
  content: commentContentSchema,
  parentId: z.string().uuid().optional(),
});
export type SeriesCommentInput = z.infer<typeof seriesCommentInput>;

export const commentRepliesListInput = z.object({
  parentId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type CommentRepliesListInput = z.infer<typeof commentRepliesListInput>;

/** Blank after trim, or only the prefilled `@username`, is not a reply. */
export function isBlankReplyContent(content: string, prefillUsernames: readonly string[]): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  return prefillUsernames.some((name) => trimmed === `@${name}`);
}

// Forum (M6) — Markdown body capped at 10k chars to keep XSS surface
// (rehype-sanitize) and Postgres TOAST fast paths predictable.
export const topicTitleSchema = z
  .string()
  .trim()
  .min(1, 'title_required')
  .max(120, 'title_too_long');
export const topicBodySchema = z
  .string()
  .trim()
  .min(1, 'body_required')
  .max(10_000, 'body_too_long');
export const replyBodySchema = z
  .string()
  .trim()
  .min(1, 'reply_required')
  .max(5_000, 'reply_too_long');

export const topicCreateInput = z.object({
  title: topicTitleSchema,
  body: topicBodySchema,
});
export type TopicCreateInput = z.infer<typeof topicCreateInput>;

export const topicUpdateInput = z.object({
  id: z.string().uuid(),
  title: topicTitleSchema,
  body: topicBodySchema,
});
export type TopicUpdateInput = z.infer<typeof topicUpdateInput>;

export const topicSetPinnedInput = z.object({
  id: z.string().uuid(),
  pinned: z.boolean(),
});
export type TopicSetPinnedInput = z.infer<typeof topicSetPinnedInput>;

export const replyCreateInput = z.object({
  topicId: z.string().uuid(),
  body: replyBodySchema,
});
export type ReplyCreateInput = z.infer<typeof replyCreateInput>;

/**
 * List cursors are Prisma ids. Users, cards, listings, topics, and reports
 * all use `@default(uuid())`, which is 36 characters. Shorter test ids still fit.
 */
export const CURSOR_MAX = 36;

const cursorSchema = z.string().max(CURSOR_MAX);

export const cursorPaginationInput = z.object({
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type CursorPaginationInput = z.infer<typeof cursorPaginationInput>;

export const pageCursorPaginationInput = z.object({
  pageCursor: cursorSchema.optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type PageCursorPaginationInput = z.infer<typeof pageCursorPaginationInput>;

// M7 — Trade listings + reports.
export const LISTING_KIND_VALUES = ['SELL', 'BUY'] as const;
export type ListingKind = (typeof LISTING_KIND_VALUES)[number];

export const LISTING_STATUS_VALUES = ['OPEN', 'CLOSED'] as const;
export type ListingStatus = (typeof LISTING_STATUS_VALUES)[number];

export const LISTING_CONDITION_VALUES = [
  'NEAR_MINT',
  'LIGHTLY_PLAYED',
  'MODERATELY_PLAYED',
  'HEAVILY_PLAYED',
  'DAMAGED',
] as const;
export type ListingCondition = (typeof LISTING_CONDITION_VALUES)[number];

export const LISTING_LANGUAGE_VALUES = ['ZH', 'EN', 'JA', 'OTHER'] as const;
export type ListingLanguage = (typeof LISTING_LANGUAGE_VALUES)[number];

export const TRADE_CURRENCY_VALUES = ['CNY', 'HKD', 'USD', 'JPY', 'EUR', 'TWD'] as const;
export type TradeCurrency = (typeof TRADE_CURRENCY_VALUES)[number];

export const LISTING_SORT_VALUES = ['newest', 'price_asc', 'price_desc'] as const;
export type ListingSort = (typeof LISTING_SORT_VALUES)[number];

export const REPORT_TARGET_VALUES = ['LISTING', 'TOPIC', 'REPLY', 'COMMENT'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_VALUES)[number];

export const REPORT_STATUS_VALUES = ['PENDING', 'RESOLVED'] as const;
export type ReportStatus = (typeof REPORT_STATUS_VALUES)[number];

export const REPORT_RESOLVE_ACTION_VALUES = ['MARK_RESOLVED', 'REMOVE_TARGET'] as const;
export type ReportResolveAction = (typeof REPORT_RESOLVE_ACTION_VALUES)[number];

// ISO 4217 codes are exactly three uppercase letters. We don't enumerate the
// full set because cardhub's audience picks per-listing (CNY default with
// USD/JPY common second). The format check at least catches typos.
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'currency_format');

/**
 * Decimal(12, 2) prints in 13 characters (`9999999999.99`). 64 leaves room for
 * the leading zeros, extra fraction digits, and short scientific notation
 * (`1e2`) that the publish form accepts via `Number()`, without taking a
 * multi-kilobyte digit string.
 */
export const LISTING_PRICE_STRING_MAX = 64;

export const listingPriceSchema = z
  .union([z.number(), z.string().max(LISTING_PRICE_STRING_MAX)])
  .transform((val, ctx) => {
    const asNumber = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(asNumber) || asNumber < 0 || asNumber > 9_999_999_999.99) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'price_range',
      });
      return z.NEVER;
    }
    // Round to 2 decimals to match Decimal(12, 2) on the database side.
    return Math.round(asNumber * 100) / 100;
  });

/** Same ceiling as the admin image fields. */
export const LISTING_IMAGE_URL_MAX = 2048;

/** Publish form rejects a fifth photo before it calls the API. */
export const LISTING_IMAGE_MAX_COUNT = 4;

export const listingPublishInput = z.object({
  cardSlug: slugSchema,
  kind: z.enum(LISTING_KIND_VALUES),
  price: listingPriceSchema.optional(),
  currency: currencyCodeSchema.default('CNY'),
  // Cap at 4 to match the publish form ("每行一个 https 链接，最多 4 张").
  // Each URL matches the admin image fields and stays well under the 100kb body cap.
  imageUrls: z
    .array(
      z
        .string()
        .trim()
        .max(LISTING_IMAGE_URL_MAX)
        .url('image_https')
        .refine((url) => url.toLowerCase().startsWith('https://'), {
          message: 'image_https',
        }),
    )
    .max(LISTING_IMAGE_MAX_COUNT, 'image_too_many')
    .default([]),
  contact: z.string().trim().min(2, 'contact_too_short').max(200, 'contact_too_long'),
  note: z.string().trim().max(500, 'note_too_long').optional(),
  condition: z.enum(LISTING_CONDITION_VALUES).optional(),
  language: z.enum(LISTING_LANGUAGE_VALUES).optional(),
  variantNote: z.string().trim().max(40, 'variant_note_too_long').optional(),
});
export type ListingPublishInput = z.infer<typeof listingPublishInput>;

export const listingListInput = cursorPaginationInput.extend({
  cardSlug: slugSchema.optional(),
  kind: z.enum(LISTING_KIND_VALUES).optional(),
  condition: z.enum(LISTING_CONDITION_VALUES).optional(),
  language: z.enum(LISTING_LANGUAGE_VALUES).optional(),
  minPrice: listingPriceSchema.optional(),
  maxPrice: listingPriceSchema.optional(),
  currency: z.enum(TRADE_CURRENCY_VALUES).optional(),
  sort: z.enum(LISTING_SORT_VALUES).default('newest'),
});
export type ListingListInput = z.infer<typeof listingListInput>;

export const listingMineInput = pageCursorPaginationInput.extend({
  cursor: cursorSchema.optional(),
});
export type ListingMineInput = z.infer<typeof listingMineInput>;

export const reportCreateInput = z.object({
  targetType: z.enum(REPORT_TARGET_VALUES),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(4, 'reason_too_short').max(500, 'reason_too_long'),
});
export type ReportCreateInput = z.infer<typeof reportCreateInput>;

export const reportListInput = cursorPaginationInput.extend({
  status: z.enum(REPORT_STATUS_VALUES).optional(),
});
export type ReportListInput = z.infer<typeof reportListInput>;

export const reportResolveInput = z.object({
  id: z.string().uuid(),
  action: z.enum(REPORT_RESOLVE_ACTION_VALUES),
  resolution: z.string().trim().max(500, 'resolution_too_long').optional(),
});
export type ReportResolveInput = z.infer<typeof reportResolveInput>;

/**
 * Signed `{ sub, username }` JWTs are a few hundred characters. 2048 leaves
 * room for extra registered claims without accepting an arbitrary blob.
 */
export const AUTH_TOKEN_MAX = 2048;

export const authTokenSchema = z.string().max(AUTH_TOKEN_MAX);

const adminImageUrlSchema = z
  .string()
  .trim()
  .max(LISTING_IMAGE_URL_MAX)
  .refine(
    (value) => value === '' || value.startsWith('https://') || value.startsWith('gradient:'),
    'image_url',
  )
  .optional();

/**
 * Seed attributes are a handful of short keys (`cost`, `type`, `随从`).
 * The editor does not set maxLength, so these caps stay wide, but 40 keys of
 * 64 and 500 characters stay under the 100kb JSON body cap even as CJK.
 */
export const ADMIN_ATTRIBUTE_MAX_KEYS = 40;
export const ADMIN_ATTRIBUTE_KEY_MAX = 64;
export const ADMIN_ATTRIBUTE_VALUE_MAX = 500;

export const adminAttributeValueSchema = z.union([
  z.string().max(ADMIN_ATTRIBUTE_VALUE_MAX),
  z.number(),
  z.boolean(),
]);
export const adminAttributesSchema = z
  .record(z.string().max(ADMIN_ATTRIBUTE_KEY_MAX), adminAttributeValueSchema)
  .refine((value) => Object.keys(value).length <= ADMIN_ATTRIBUTE_MAX_KEYS, {
    message: 'attributes_too_many',
  });

/** Printed card number. Empty string clears it. The grid renders a leading #. */
export const CARD_NUMBER_MAX = 20;

export const SUBSET_KIND_VALUES = ['BASE', 'INSERT'] as const;
export type SubsetKindValue = (typeof SUBSET_KIND_VALUES)[number];

/** Omitted sort keeps the historical `createdAt` ascending order. */
export const SERIES_LIST_SORT_VALUES = [
  'createdAtAsc',
  'createdAtDesc',
  'releaseDateAsc',
  'releaseDateDesc',
] as const;
export type SeriesListSort = (typeof SERIES_LIST_SORT_VALUES)[number];

const RELEASE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date `YYYY-MM-DD`. Rejects impossible days such as 2024-02-31. */
export const releaseDateSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const match = RELEASE_DATE_PATTERN.exec(value);
    if (!match) {
      ctx.addIssue({ code: 'custom', message: 'invalid_date' });
      return;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      ctx.addIssue({ code: 'custom', message: 'invalid_date' });
    }
  });

/** Empty string clears the value. Omitted leaves the stored value alone. */
export const optionalSlugOrEmpty = z.union([slugSchema, z.literal('')]).optional();
export const optionalReleaseDateInput = z.union([releaseDateSchema, z.literal('')]).optional();

const catalogSortOrderSchema = z.number().int().min(-2_147_483_648).max(2_147_483_647);

export const seriesListInput = paginationSchema.extend({
  categorySlug: slugSchema.optional(),
  year: z.number().int().min(1).max(9999).optional(),
  sort: z.enum(SERIES_LIST_SORT_VALUES).optional(),
});
export type SeriesListInput = z.infer<typeof seriesListInput>;

export const adminSeriesUpsertInput = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional(),
  coverUrl: adminImageUrlSchema,
  categorySlug: optionalSlugOrEmpty,
  releaseDate: optionalReleaseDateInput,
});
export type AdminSeriesUpsertInput = z.infer<typeof adminSeriesUpsertInput>;

export const adminCardUpsertInput = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional(),
  rarity: z.enum(RARITY_VALUES),
  imageUrl: adminImageUrlSchema,
  attributes: adminAttributesSchema.default({}),
  seriesSlug: slugSchema,
  cardNumber: z.string().trim().max(CARD_NUMBER_MAX).optional(),
  subsetSlug: optionalSlugOrEmpty,
});
export type AdminCardUpsertInput = z.infer<typeof adminCardUpsertInput>;

export const adminCategoryUpsertInput = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional(),
  sortOrder: catalogSortOrderSchema.default(0),
});
export type AdminCategoryUpsertInput = z.infer<typeof adminCategoryUpsertInput>;

export const adminCategoryDeleteInput = z.object({
  slug: slugSchema,
});
export type AdminCategoryDeleteInput = z.infer<typeof adminCategoryDeleteInput>;

export const adminSubsetListInput = z.object({
  seriesSlug: slugSchema,
});
export type AdminSubsetListInput = z.infer<typeof adminSubsetListInput>;

export const adminSubsetUpsertInput = z.object({
  seriesSlug: slugSchema,
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000, 'description_too_long').optional(),
  kind: z.enum(SUBSET_KIND_VALUES),
  sortOrder: catalogSortOrderSchema.default(0),
});
export type AdminSubsetUpsertInput = z.infer<typeof adminSubsetUpsertInput>;

export const adminSubsetDeleteInput = z.object({
  seriesSlug: slugSchema,
  slug: slugSchema,
});
export type AdminSubsetDeleteInput = z.infer<typeof adminSubsetDeleteInput>;

/** Optional admin delete reason. Trimmed, then 0–500 characters. */
export const DELETE_REASON_MAX = 500;

export const optionalDeleteReason = z
  .string()
  .trim()
  .max(DELETE_REASON_MAX, { message: 'delete_reason_too_long' })
  .optional();

export const adminSeriesDeleteInput = z.object({
  slug: slugSchema,
  force: z.boolean().default(false),
  reason: optionalDeleteReason,
});
export type AdminSeriesDeleteInput = z.infer<typeof adminSeriesDeleteInput>;

export const adminCardDeleteInput = z.object({
  slug: slugSchema,
  reason: optionalDeleteReason,
});
export type AdminCardDeleteInput = z.infer<typeof adminCardDeleteInput>;

export const adminCatalogImportInput = z.object({
  data: z.unknown(),
  dryRun: z.boolean().default(true),
});
export type AdminCatalogImportInput = z.infer<typeof adminCatalogImportInput>;

export const ADMIN_USER_STATUS_VALUES = ['active', 'banned'] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUS_VALUES)[number];

/** Ban and unban reasons are required after trim, and at most 500 characters. */
export const BAN_REASON_MAX = 500;

export const adminUsersListInput = z.object({
  q: z.string().trim().max(EMAIL_MAX).optional(),
  status: z.enum(ADMIN_USER_STATUS_VALUES).optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type AdminUsersListInput = z.infer<typeof adminUsersListInput>;

export const adminUserBanInput = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(1).max(BAN_REASON_MAX),
});
export type AdminUserBanInput = z.infer<typeof adminUserBanInput>;

export const AUDIT_ACTION_VALUES = [
  'USER_BAN',
  'USER_UNBAN',
  'CONTENT_DELETE',
  'REPORT_RESOLVE',
] as const;
export type AuditAction = (typeof AUDIT_ACTION_VALUES)[number];

export const adminAuditListInput = z.object({
  action: z.enum(AUDIT_ACTION_VALUES).optional(),
  user: z.string().trim().min(1).max(24).optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(50).default(50),
});
export type AdminAuditListInput = z.infer<typeof adminAuditListInput>;
