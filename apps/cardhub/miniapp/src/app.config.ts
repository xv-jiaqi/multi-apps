import { APP_PAGES, PAGE_BACKGROUND, TAB_BAR_COLORS, TAB_BAR_ITEMS } from './lib/tab-bar';

export default defineAppConfig({
  pages: [...APP_PAGES],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: TAB_BAR_COLORS.backgroundColor,
    navigationBarTitleText: 'Cardhub',
    navigationBarTextStyle: 'black',
    backgroundColor: PAGE_BACKGROUND,
  },
  tabBar: {
    ...TAB_BAR_COLORS,
    borderStyle: 'black',
    list: TAB_BAR_ITEMS.map(({ pagePath, text, iconPath, selectedIconPath }) => ({
      pagePath,
      text,
      iconPath,
      selectedIconPath,
    })),
  },
});
