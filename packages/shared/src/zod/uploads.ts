import { z } from 'zod';

export const UPLOAD_PURPOSES = ['listing', 'card', 'series'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

/** 5 MiB. Matches CH-245 / CH-208. */
export const UPLOAD_SIZE_MAX = 5_242_880;

export const createPresignedPutInput = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.enum(UPLOAD_CONTENT_TYPES),
  size: z.number().int().positive().max(UPLOAD_SIZE_MAX),
});
export type CreatePresignedPutInput = z.infer<typeof createPresignedPutInput>;

export const createPresignedPutResult = z.object({
  uploadUrl: z.string().min(1),
  publicUrl: z.string().min(1),
  method: z.literal('PUT'),
  headers: z.object({ 'Content-Type': z.enum(UPLOAD_CONTENT_TYPES) }).optional(),
  objectKey: z.string().min(1),
});
export type CreatePresignedPutResult = z.infer<typeof createPresignedPutResult>;
