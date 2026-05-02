import { makeAutoObservable } from 'mobx';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@repo/shared';

/**
 * Pluggable persistence so the same store works across browser
 * (localStorage), Tauri (window.localStorage shim), and miniapp
 * (Taro.getStorageSync). Pass null to opt out — useful in tests.
 */
export interface LocaleStorageDriver {
  get(): Locale | null;
  set(locale: Locale): void;
  clear(): void;
}

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export class LocaleStore {
  locale: Locale = DEFAULT_LOCALE;

  constructor(private readonly driver?: LocaleStorageDriver | null) {
    makeAutoObservable<this, 'driver'>(this, { driver: false });
    if (driver) {
      const cached = driver.get();
      if (isLocale(cached)) {
        this.locale = cached;
      }
    }
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
    this.driver?.set(locale);
  }
}
