import type { Locale } from '@repo/shared';

export function formatDateTime(iso: string, locale: Locale): string {
  const tag = locale === 'en-US' ? 'en-US' : 'zh-CN';
  return new Date(iso).toLocaleString(tag);
}
