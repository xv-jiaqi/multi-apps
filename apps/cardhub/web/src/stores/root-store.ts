import { createContext, useContext } from 'react';
import { autorun } from 'mobx';
import {
  LocaleStore,
  SessionStore,
  type LocaleStorageDriver,
  type SessionStorageDriver,
} from '@repo/stores';

const SESSION_KEY = 'cardhub:session';
const LOCALE_KEY = 'cardhub:locale';

const browserSessionDriver: SessionStorageDriver | null =
  typeof window === 'undefined'
    ? null
    : {
        get() {
          try {
            const raw = window.localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as {
              token: string;
              user: {
                id: string;
                username: string;
                role?: string;
                passwordChangeRecommended?: boolean;
                bannedAt?: string | null;
              };
            };
            if (!parsed?.token || !parsed?.user) return null;
            return { token: parsed.token, user: parsed.user };
          } catch {
            return null;
          }
        },
        set(value) {
          try {
            window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
          } catch {
            // Storage may be disabled (private mode); fall back to memory.
          }
        },
        clear() {
          try {
            window.localStorage.removeItem(SESSION_KEY);
          } catch {
            // ignore
          }
        },
      };

const browserLocaleDriver: LocaleStorageDriver | null =
  typeof window === 'undefined'
    ? null
    : {
        get() {
          try {
            const value = window.localStorage.getItem(LOCALE_KEY);
            return (value as ReturnType<LocaleStorageDriver['get']>) ?? null;
          } catch {
            return null;
          }
        },
        set(locale) {
          try {
            window.localStorage.setItem(LOCALE_KEY, locale);
          } catch {
            // ignore
          }
        },
        clear() {
          try {
            window.localStorage.removeItem(LOCALE_KEY);
          } catch {
            // ignore
          }
        },
      };

export class RootStore {
  readonly locale = new LocaleStore(browserLocaleDriver);
  readonly session = new SessionStore(browserSessionDriver);
}

export const rootStore = new RootStore();

// Keep <html lang> in sync with the active locale via MobX autorun. Using
// autorun rather than a React effect means the binding survives across
// route changes and is set up exactly once at module load.
if (typeof document !== 'undefined') {
  autorun(() => {
    document.documentElement.lang = rootStore.locale.locale;
  });
}

const StoreContext = createContext<RootStore>(rootStore);

export const StoreProvider = StoreContext.Provider;

export function useStores(): RootStore {
  return useContext(StoreContext);
}
