import { makeAutoObservable } from 'mobx';
import { DEFAULT_LOCALE, type Locale } from '@repo/shared';

export class LocaleStore {
  locale: Locale = DEFAULT_LOCALE;

  constructor() {
    makeAutoObservable(this);
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
  }
}
