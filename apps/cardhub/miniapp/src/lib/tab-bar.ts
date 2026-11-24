// `app.config.ts` is native JSON for the WeChat runtime, so SCSS tokens cannot
// be referenced there. Each literal below names its token in
// `packages/design-tokens/src/taro.scss`; `tab-bar.test.ts` keeps them equal.
// This file has no Taro import so both the build-time config and the runtime
// (`app.tsx`) can read it.
export const TAB_BAR_COLORS = {
  /** $color-neutral-600 */
  color: '#525252',
  /** $color-brand-600 */
  selectedColor: '#2563eb',
  /** $color-white */
  backgroundColor: '#ffffff',
} as const;

/** $color-page */
export const PAGE_BACKGROUND = '#f6f6f6';

/**
 * CH-301 §1 tabBar. Labels are the zh-CN defaults; `app.tsx` swaps them to
 * the current locale with `Taro.setTabBarItem` (`tab.*` keys). Trade joins between forum and me in the trade PR, once its list page
 * exists (WeChat rejects a tab whose page is not registered).
 */
export const TAB_BAR_ITEMS = [
  {
    pagePath: 'pages/index/index',
    text: '首页',
    textKey: 'tab.home',
    iconPath: 'assets/tab/home.png',
    selectedIconPath: 'assets/tab/home-active.png',
  },
  {
    pagePath: 'pages/forum/list/index',
    text: '论坛',
    textKey: 'tab.forum',
    iconPath: 'assets/tab/forum.png',
    selectedIconPath: 'assets/tab/forum-active.png',
  },
  {
    pagePath: 'pages/me/index',
    text: '我的',
    textKey: 'tab.me',
    iconPath: 'assets/tab/me.png',
    selectedIconPath: 'assets/tab/me-active.png',
  },
] as const;

export const APP_PAGES = [
  'pages/index/index',
  'pages/forum/list/index',
  'pages/me/index',
  'pages/series/list/index',
  'pages/series/detail/index',
  'pages/cards/detail/index',
  'pages/search/index/index',
  'pages/auth/login/index',
  'pages/auth/register/index',
  'pages/forum/detail/index',
  'pages/forum/new/index',
] as const;
