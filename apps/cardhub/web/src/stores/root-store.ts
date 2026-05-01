import { createContext, useContext } from 'react';
import { LocaleStore, SessionStore } from '@repo/stores';

export class RootStore {
  readonly locale = new LocaleStore();
  readonly session = new SessionStore();
}

export const rootStore = new RootStore();

const StoreContext = createContext<RootStore>(rootStore);

export const StoreProvider = StoreContext.Provider;

export function useStores(): RootStore {
  return useContext(StoreContext);
}
