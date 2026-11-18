import type { CreatePresignedPutResult, UploadContentType, UploadPurpose } from '@repo/shared';

const EXTENSION_BY_CONTENT_TYPE: Record<UploadContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `yyyymm` in the object key is the UTC calendar month. */
export function utcYearMonth(now: Date): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

export function uploadObjectExtension(contentType: UploadContentType): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType];
}

/**
 * `purpose/userId/yyyymm/uuid.ext` (CH-245 / CH-208).
 * `yyyymm` is UTC. `uuid` is the raw RFC 4122 text, including hyphens.
 */
export function buildUploadObjectKey(input: {
  purpose: UploadPurpose;
  userId: string;
  contentType: UploadContentType;
  now: Date;
  id: string;
}): string {
  const month = utcYearMonth(input.now);
  const ext = uploadObjectExtension(input.contentType);
  return `${input.purpose}/${input.userId}/${month}/${input.id}.${ext}`;
}

export function publicUrlFor(publicBaseUrl: string, objectKey: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${objectKey}`;
}

export function buildPresignedPutResult(input: {
  uploadUrl: string;
  publicBaseUrl: string;
  objectKey: string;
  contentType: UploadContentType;
}): CreatePresignedPutResult {
  return {
    uploadUrl: input.uploadUrl,
    publicUrl: publicUrlFor(input.publicBaseUrl, input.objectKey),
    method: 'PUT',
    headers: { 'Content-Type': input.contentType },
    objectKey: input.objectKey,
  };
}
