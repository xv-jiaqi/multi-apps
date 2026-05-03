import { z } from 'zod';

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

export const emailSchema = z.string().trim().toLowerCase().email('邮箱格式不正确');

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

export const commentInput = z.object({
  cardSlug: slugSchema,
  content: z.string().trim().min(1, '评论不能为空').max(500, '评论最多 500 字'),
});
export type CommentInput = z.infer<typeof commentInput>;

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

export const replyCreateInput = z.object({
  topicId: z.string().uuid(),
  body: replyBodySchema,
});
export type ReplyCreateInput = z.infer<typeof replyCreateInput>;

export const cursorPaginationInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type CursorPaginationInput = z.infer<typeof cursorPaginationInput>;

// M7 — Trade listings + reports.
export const LISTING_KIND_VALUES = ['SELL', 'BUY'] as const;
export type ListingKind = (typeof LISTING_KIND_VALUES)[number];

export const LISTING_STATUS_VALUES = ['OPEN', 'CLOSED'] as const;
export type ListingStatus = (typeof LISTING_STATUS_VALUES)[number];

export const REPORT_TARGET_VALUES = ['LISTING', 'TOPIC', 'REPLY', 'COMMENT'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_VALUES)[number];

export const REPORT_STATUS_VALUES = ['PENDING', 'RESOLVED'] as const;
export type ReportStatus = (typeof REPORT_STATUS_VALUES)[number];

// ISO 4217 codes are exactly three uppercase letters. We don't enumerate the
// full set because cardhub's audience picks per-listing (CNY default with
// USD/JPY common second). The format check at least catches typos.
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, '货币代码必须是 3 个大写字母 (ISO 4217)');

export const listingPriceSchema = z.union([z.number(), z.string()]).transform((val, ctx) => {
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

export const listingPublishInput = z.object({
  cardSlug: slugSchema,
  kind: z.enum(LISTING_KIND_VALUES),
  price: listingPriceSchema.optional(),
  currency: currencyCodeSchema.default('CNY'),
  // Cap at 4 to keep the schema close to "thumbnails the user can post" —
  // larger image collections belong in the (backlog) self-hosted pipeline.
  imageUrls: z.array(z.string().trim().url('图片链接必须是有效的 URL')).max(4).default([]),
  contact: z.string().trim().min(2, '联系方式至少 2 个字符').max(200, '联系方式最多 200 字'),
  note: z.string().trim().max(500, '说明最多 500 字').optional(),
});
export type ListingPublishInput = z.infer<typeof listingPublishInput>;

export const listingListInput = cursorPaginationInput.extend({
  cardSlug: slugSchema.optional(),
  kind: z.enum(LISTING_KIND_VALUES).optional(),
});
export type ListingListInput = z.infer<typeof listingListInput>;

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
