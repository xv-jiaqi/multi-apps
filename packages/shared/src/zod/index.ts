import { z } from 'zod';

export const RARITY_VALUES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITY_VALUES)[number];

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a kebab-case slug');

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
  .min(3, '用户名至少 3 个字符')
  .max(24, '用户名最多 24 个字符')
  .regex(/^[A-Za-z0-9_-]+$/, '用户名只能包含字母、数字、下划线和连字符');

/** Same cap as the login identifier, so a registered email can be used to sign in. */
export const EMAIL_MAX = 128;

export const emailSchema = z.string().trim().max(EMAIL_MAX).toLowerCase().email('邮箱格式不正确');

export const passwordSchema = z.string().min(8, '密码至少 8 位').max(128, '密码过长');

export const registerInput = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const loginInput = z.object({
  identifier: z.string().trim().min(3, '请输入邮箱或用户名').max(128),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerInput>;
export type LoginInput = z.infer<typeof loginInput>;

export const commentContentSchema = z
  .string()
  .trim()
  .min(1, '评论不能为空')
  .max(500, '评论最多 500 字');

export const commentInput = z.object({
  cardSlug: slugSchema,
  content: commentContentSchema,
});
export type CommentInput = z.infer<typeof commentInput>;

export const seriesCommentInput = z.object({
  seriesSlug: slugSchema,
  content: commentContentSchema,
});
export type SeriesCommentInput = z.infer<typeof seriesCommentInput>;

// Forum (M6) — Markdown body capped at 10k chars to keep XSS surface
// (rehype-sanitize) and Postgres TOAST fast paths predictable.
export const topicTitleSchema = z
  .string()
  .trim()
  .min(1, '标题不能为空')
  .max(120, '标题最多 120 字');
export const topicBodySchema = z
  .string()
  .trim()
  .min(1, '正文不能为空')
  .max(10_000, '正文最多 10000 字');
export const replyBodySchema = z
  .string()
  .trim()
  .min(1, '回帖不能为空')
  .max(5_000, '回帖最多 5000 字');

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
  .regex(/^[A-Z]{3}$/, '货币代码必须是 3 个大写字母 (ISO 4217)');

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
        message: '价格必须是 0 到 9,999,999,999.99 之间的数字',
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
        .url('trade.publish.error.imageUrl')
        .refine((url) => url.toLowerCase().startsWith('https://'), {
          message: 'trade.publish.error.imageUrl',
        }),
    )
    .max(LISTING_IMAGE_MAX_COUNT, 'trade.publish.error.tooManyImages')
    .default([]),
  contact: z.string().trim().min(2, '联系方式至少 2 个字符').max(200, '联系方式最多 200 字'),
  note: z.string().trim().max(500, '说明最多 500 字').optional(),
  condition: z.enum(LISTING_CONDITION_VALUES).optional(),
  language: z.enum(LISTING_LANGUAGE_VALUES).optional(),
  variantNote: z.string().trim().max(40, '版本备注最多 40 字').optional(),
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
  reason: z.string().trim().min(4, '请简要说明原因，至少 4 个字符').max(500, '原因最多 500 字'),
});
export type ReportCreateInput = z.infer<typeof reportCreateInput>;

export const reportListInput = cursorPaginationInput.extend({
  status: z.enum(REPORT_STATUS_VALUES).optional(),
});
export type ReportListInput = z.infer<typeof reportListInput>;

export const reportResolveInput = z.object({
  id: z.string().uuid(),
  action: z.enum(REPORT_RESOLVE_ACTION_VALUES),
  resolution: z.string().trim().max(500, '处理说明最多 500 字').optional(),
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
    'Image URL must be empty, https://, or gradient:',
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
    message: `At most ${ADMIN_ATTRIBUTE_MAX_KEYS} attributes`,
  });

export const adminSeriesUpsertInput = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).optional(),
  coverUrl: adminImageUrlSchema,
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
});
export type AdminCardUpsertInput = z.infer<typeof adminCardUpsertInput>;

export const adminSeriesDeleteInput = z.object({
  slug: slugSchema,
  force: z.boolean().default(false),
});
export type AdminSeriesDeleteInput = z.infer<typeof adminSeriesDeleteInput>;

export const adminCardDeleteInput = z.object({
  slug: slugSchema,
});
export type AdminCardDeleteInput = z.infer<typeof adminCardDeleteInput>;

export const adminCatalogImportInput = z.object({
  data: z.unknown(),
  dryRun: z.boolean().default(true),
});
export type AdminCatalogImportInput = z.infer<typeof adminCatalogImportInput>;
