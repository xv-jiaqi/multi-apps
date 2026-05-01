import { createContext, useContext } from 'react';
import { LocaleStore, SessionStore, type SessionStorageDriver } from '@repo/stores';

const STORAGE_KEY = 'cardhub:session';

const browserStorageDriver: SessionStorageDriver | null =
  typeof window === 'undefined'
    ? null
    : {
        get() {
          try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as {
              token: string;
              user: { id: string; username: string };
            };
            if (!parsed?.token || !parsed?.user) return null;
            return { token: parsed.token, user: parsed.user };
          } catch {
            return null;
          }
        },
        set(value) {
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
          } catch {
            // Storage may be disabled (private mode); fall back to memory.
          }
        },
        clear() {
          try {
            window.localStorage.removeItem(STORAGE_KEY);
          } catch {
            // ignore
          }
        },
      };

export class RootStore {
  readonly locale = new LocaleStore();
  readonly session = new SessionStore(browserStorageDriver);
}

export const rootStore = new RootStore();

const StoreContext = createContext<RootStore>(rootStore);

export const StoreProvider = StoreContext.Provider;

export function useStores(): RootStore {
  return useContext(StoreContext);
}
