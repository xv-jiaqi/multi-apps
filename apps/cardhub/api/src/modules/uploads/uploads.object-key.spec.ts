import { buildPresignedPutResult, buildUploadObjectKey, publicUrlFor } from './uploads.object-key';

describe('buildUploadObjectKey', () => {
  it('uses purpose/userId/UTC yyyymm/uuid.ext', () => {
    expect(
      buildUploadObjectKey({
        purpose: 'listing',
        userId: 'user-1',
        contentType: 'image/jpeg',
        now: new Date('2026-11-18T16:00:00.000Z'),
        id: '11111111-2222-4333-8444-555555555555',
      }),
    ).toBe('listing/user-1/202611/11111111-2222-4333-8444-555555555555.jpg');
    expect(
      buildUploadObjectKey({
        purpose: 'card',
        userId: 'admin-1',
        contentType: 'image/webp',
        now: new Date('2026-01-01T00:00:00.000Z'),
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      }),
    ).toBe('card/admin-1/202601/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp');
  });
});

describe('buildPresignedPutResult', () => {
  it('joins the public base URL and sets PUT with the content type', () => {
    expect(
      buildPresignedPutResult({
        uploadUrl: 'https://oss.example/put',
        publicBaseUrl: 'https://cdn.example.com/media/',
        objectKey: 'series/u1/202611/id.png',
        contentType: 'image/png',
      }),
    ).toEqual({
      uploadUrl: 'https://oss.example/put',
      publicUrl: 'https://cdn.example.com/media/series/u1/202611/id.png',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      objectKey: 'series/u1/202611/id.png',
    });
    expect(publicUrlFor('https://cdn.example.com', 'listing/u/202611/id.jpg')).toBe(
      'https://cdn.example.com/listing/u/202611/id.jpg',
    );
  });
});
