export const UPLOAD_OSS_ENV_KEYS = [
  'OSS_ENDPOINT',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
  'OSS_PUBLIC_BASE_URL',
] as const;

export type UploadOssEnvKey = (typeof UPLOAD_OSS_ENV_KEYS)[number];

export type UploadsConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  publicBaseUrl: string;
};

type EnvMap = Readonly<Record<string, string | undefined>>;

function readTrimmed(env: EnvMap, key: UploadOssEnvKey): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/**
 * All five placeholders must be non-empty. A missing or blank value means
 * uploads are not configured. Callers must not put the key names in client
 * errors or logs of this result.
 */
export function readUploadsConfig(env: EnvMap): UploadsConfig | undefined {
  const endpoint = readTrimmed(env, 'OSS_ENDPOINT');
  const bucket = readTrimmed(env, 'OSS_BUCKET');
  const accessKeyId = readTrimmed(env, 'OSS_ACCESS_KEY_ID');
  const accessKeySecret = readTrimmed(env, 'OSS_ACCESS_KEY_SECRET');
  const publicBaseUrl = readTrimmed(env, 'OSS_PUBLIC_BASE_URL');
  if (!endpoint || !bucket || !accessKeyId || !accessKeySecret || !publicBaseUrl) {
    return undefined;
  }
  return { endpoint, bucket, accessKeyId, accessKeySecret, publicBaseUrl };
}
