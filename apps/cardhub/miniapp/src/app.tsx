import type { PropsWithChildren } from 'react';
import { rootStore, StoreProvider } from './stores/root-store';
import './app.scss';

/**
 * Miniapp entry. Wraps every page with the MobX RootStore provider so pages
 * can call `useStores()` to read LocaleStore / SessionStore. Provider
 * placement matters: `App` is rendered *outside* every page's lifecycle in
 * the Taro runtime, so the provider persists across page transitions.
 *
 * There is no autorun-to-<html lang> sync here (as opposed to web) because
 * miniapp runtimes have no `<html>` element. Pages read `locale.locale`
 * directly via MobX observer.
 */
function App({ children }: PropsWithChildren) {
  return <StoreProvider value={rootStore}>{children}</StoreProvider>;
}

export default App;
