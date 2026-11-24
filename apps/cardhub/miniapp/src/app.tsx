import { useEffect, type PropsWithChildren } from 'react';
import { reaction } from 'mobx';
import Taro from '@tarojs/taro';
import { rootStore, StoreProvider } from './stores/root-store';
import { applyTabBarLabels } from './lib/apply-tab-bar-labels';
import { miniappVisit } from './lib/miniapp-visit';
import './app.scss';

/**
 * Miniapp entry. Wraps every page with the MobX RootStore provider so pages
 * can call `useStores()` to read LocaleStore / SessionStore. Provider
 * placement matters: `App` is rendered *outside* every page's lifecycle in
 * the Taro runtime, so the provider persists across page transitions.
 *
 * There is no autorun-to-<html lang> sync here (as opposed to web) because
 * miniapp runtimes have no `<html>` element. Pages read `locale.locale`
 * directly via MobX observer. Tab labels are native, so they follow the
 * locale through `Taro.setTabBarItem`.
 */
function App({ children }: PropsWithChildren) {
  useEffect(
    () => reaction(() => rootStore.locale.locale, applyTabBarLabels, { fireImmediately: true }),
    [],
  );
  useEffect(
    () =>
      reaction(
        () => rootStore.session.isAuthenticated,
        (authenticated) => {
          if (authenticated) {
            void miniappVisit.reportVisit();
            return;
          }
          miniappVisit.reset();
        },
      ),
    [],
  );
  Taro.useLaunch(() => {
    void miniappVisit.reportVisit();
  });
  Taro.useDidShow(() => {
    applyTabBarLabels();
    void miniappVisit.reportVisit();
  });
  return <StoreProvider value={rootStore}>{children}</StoreProvider>;
}

export default App;
