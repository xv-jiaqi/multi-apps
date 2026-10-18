export const APP_NAME = 'Cardhub';

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/**
 * Business error codes shared by the API and web (CH-211, CH-212, CH-209).
 * Add new codes here. Do not copy these strings into api or web.
 */
export const APP_ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  SAME_PASSWORD: 'SAME_PASSWORD',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
} satisfies {
  readonly UNAUTHORIZED: 'UNAUTHORIZED';
  readonly WRONG_PASSWORD: 'WRONG_PASSWORD';
  readonly SAME_PASSWORD: 'SAME_PASSWORD';
  readonly TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS';
};

export type AppErrorCode = (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];

const APP_ERROR_CODE_VALUES: readonly AppErrorCode[] = [
  APP_ERROR_CODES.UNAUTHORIZED,
  APP_ERROR_CODES.WRONG_PASSWORD,
  APP_ERROR_CODES.SAME_PASSWORD,
  APP_ERROR_CODES.TOO_MANY_REQUESTS,
];

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && APP_ERROR_CODE_VALUES.some((code) => code === value);
}

export const ADMIN_CATALOG_ERROR_CODES = [
  'REQUIRED',
  'TOO_LONG',
  'SLUG_FORMAT',
  'SLUG_TAKEN',
  'SLUG_DUPLICATE_IN_FILE',
  'IMAGE_URL',
  'INVALID_RARITY',
  'INVALID_TYPE',
  'SERIES_NOT_FOUND',
  'SERIES_HAS_CARDS',
] as const;

export type AdminCatalogErrorCode = (typeof ADMIN_CATALOG_ERROR_CODES)[number];
