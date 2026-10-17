export const APP_NAME = 'Cardhub';

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';

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
