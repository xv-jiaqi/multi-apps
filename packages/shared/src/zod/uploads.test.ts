import { describe, expect, it } from 'vitest';
import { UPLOAD_SIZE_MAX, createPresignedPutInput, createPresignedPutResult } from './uploads';

const valid = {
  purpose: 'listing' as const,
  contentType: 'image/png' as const,
  size: 1024,
};

describe('createPresignedPutInput', () => {
  it('accepts the three purposes and image types up to 5 MiB', () => {
    expect(createPresignedPutInput.safeParse(valid).success).toBe(true);
    expect(
      createPresignedPutInput.safeParse({ ...valid, purpose: 'card', contentType: 'image/jpeg' })
        .success,
    ).toBe(true);
    expect(
      createPresignedPutInput.safeParse({
        ...valid,
        purpose: 'series',
        contentType: 'image/webp',
        size: UPLOAD_SIZE_MAX,
      }).success,
    ).toBe(true);
  });

  it('rejects a non-image type, a non-positive size, and anything over 5 MiB', () => {
    expect(createPresignedPutInput.safeParse({ ...valid, contentType: 'image/gif' }).success).toBe(
      false,
    );
    expect(createPresignedPutInput.safeParse({ ...valid, size: 0 }).success).toBe(false);
    expect(createPresignedPutInput.safeParse({ ...valid, size: -1 }).success).toBe(false);
    expect(createPresignedPutInput.safeParse({ ...valid, size: 1.5 }).success).toBe(false);
    expect(createPresignedPutInput.safeParse({ ...valid, size: UPLOAD_SIZE_MAX + 1 }).success).toBe(
      false,
    );
  });
});

describe('createPresignedPutResult', () => {
  it('requires PUT, urls, and objectKey', () => {
    const parsed = createPresignedPutResult.safeParse({
      uploadUrl: 'https://oss.example/put',
      publicUrl: 'https://cdn.example/listing/u/202611/id.png',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      objectKey: 'listing/u/202611/id.png',
    });
    expect(parsed.success).toBe(true);
    expect(createPresignedPutResult.safeParse({ ...parsed.data, method: 'POST' }).success).toBe(
      false,
    );
  });
});
