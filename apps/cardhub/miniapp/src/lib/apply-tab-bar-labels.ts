import Taro from '@tarojs/taro';
import { t } from '@repo/shared';
import { rootStore } from '../stores/root-store';
import { TAB_BAR_ITEMS } from './tab-bar';

/** Set native tab labels to the current locale. Safe to call off a tab page. */
export function applyTabBarLabels(): void {
  TAB_BAR_ITEMS.forEach((item, index) => {
    Taro.setTabBarItem({ index, text: t(rootStore.locale.locale, item.textKey) }).catch(() => {
      // Not on a tab page yet: the native bar keeps its zh-CN default until
      // a tab page's useDidShow runs.
    });
  });
}
