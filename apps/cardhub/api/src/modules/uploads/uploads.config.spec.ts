import { readUploadsConfig } from './uploads.config';

const complete = {
  OSS_ENDPOINT: 'oss-cn-hongkong.aliyuncs.com',
  OSS_BUCKET: 'cardhub-uploads',
  OSS_ACCESS_KEY_ID: 'id',
  OSS_ACCESS_KEY_SECRET: 'secret',
  OSS_PUBLIC_BASE_URL: 'https://cdn.example.com',
};

describe('readUploadsConfig', () => {
  it('returns nothing when any placeholder is missing or blank', () => {
    expect(readUploadsConfig({})).toBeUndefined();
    expect(readUploadsConfig({ ...complete, OSS_BUCKET: '' })).toBeUndefined();
    expect(readUploadsConfig({ ...complete, OSS_ACCESS_KEY_SECRET: '   ' })).toBeUndefined();
    expect(readUploadsConfig({ ...complete, OSS_PUBLIC_BASE_URL: undefined })).toBeUndefined();
  });

  it('trims values when all five are set', () => {
    expect(readUploadsConfig({ ...complete, OSS_BUCKET: '  cardhub-uploads  ' })).toEqual({
      endpoint: 'oss-cn-hongkong.aliyuncs.com',
      bucket: 'cardhub-uploads',
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      publicBaseUrl: 'https://cdn.example.com',
    });
  });
});
