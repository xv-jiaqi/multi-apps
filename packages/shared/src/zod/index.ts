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
