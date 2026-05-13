import { createContext, useContext } from 'react';
import Taro from '@tarojs/taro';
import {
  LocaleStore,
  SessionStore,
  type LocaleStorageDriver,
  type SessionStorageDriver,
} from '@repo/stores';

const SESSION_KEY = 'cardhub:session';
const LOCALE_KEY = 'cardhub:locale';

/**
 * Taro storage drivers work identically across weapp / alipay / tt / swan /
 * qq / h5 runtimes — Taro normalises `Taro.getStorageSync` to `localStorage`
 * in the H5 bundle. No `typeof window` guard needed.
 */
const taroSessionStorageDriver: SessionStorageDriver = {
  get() {
    try {
      const raw = Taro.getStorageSync(SESSION_KEY);
      if (!raw) return null;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed?.token || !parsed?.user) return null;
      return {
        token: parsed.token as string,
        user: parsed.user as { id: string; username: string; role?: string },
      };
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      Taro.setStorageSync(SESSION_KEY, JSON.stringify(value));
    } catch {
      // Storage may be unavailable; fall back to in-memory state.
    }
  },
  clear() {
    try {
      Taro.removeStorageSync(SESSION_KEY);
    } catch {
      // ignore
    }
  },
};

const taroLocaleStorageDriver: LocaleStorageDriver = {
  get() {
    try {
      const raw = Taro.getStorageSync(LOCALE_KEY);
      if (typeof raw !== 'string' || raw.length === 0) return null;
      return raw as ReturnType<LocaleStorageDriver['get']>;
    } catch {
      return null;
    }
  },
  set(locale) {
    try {
      Taro.setStorageSync(LOCALE_KEY, locale);
    } catch {
      // ignore
    }
  },
  clear() {
    try {
      Taro.removeStorageSync(LOCALE_KEY);
    } catch {
      // ignore
    }
  },
};

export class RootStore {
  readonly locale = new LocaleStore(taroLocaleStorageDriver);
  readonly session = new SessionStore(taroSessionStorageDriver);
}

export const rootStore = new RootStore();

const StoreContext = createContext<RootStore>(rootStore);

export const StoreProvider = StoreContext.Provider;

export function useStores(): RootStore {
  return useContext(StoreContext);
}
