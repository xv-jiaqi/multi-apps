import { z } from 'zod';

export const CONTENT_SECURITY_TEST_RESULTS = ['pass', 'review', 'risky'] as const;
export type ContentSecurityTestResult = (typeof CONTENT_SECURITY_TEST_RESULTS)[number];

const testResultSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}, z.enum(CONTENT_SECURITY_TEST_RESULTS).nullable());

function envString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface ContentSecurityEnv {
  nodeEnv: string;
  appId: string;
  appSecret: string;
  callbackToken: string;
  testResult: ContentSecurityTestResult | null;
  credentialsConfigured: boolean;
}

export function readContentSecurityEnv(
  source: Record<string, unknown> = process.env,
): ContentSecurityEnv {
  const parsedTest = testResultSchema.safeParse(source.CONTENT_SECURITY_TEST_RESULT);
  if (!parsedTest.success) {
    throw new Error('CONTENT_SECURITY_TEST_RESULT must be empty or one of: pass, review, risky');
  }

  const appId = envString(source.WECHAT_APP_ID);
  const appSecret = envString(source.WECHAT_APP_SECRET);
  return {
    nodeEnv: envString(source.NODE_ENV),
    appId,
    appSecret,
    callbackToken: envString(source.WECHAT_MEDIA_CHECK_CALLBACK_TOKEN),
    testResult: parsedTest.data,
    credentialsConfigured: appId.length > 0 && appSecret.length > 0,
  };
}

export function contentSecurityEnvError(config: ContentSecurityEnv): string | undefined {
  if (config.nodeEnv === 'production' && config.testResult !== null) {
    return 'CONTENT_SECURITY_TEST_RESULT must not be set when NODE_ENV=production';
  }
  return undefined;
}
