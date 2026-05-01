import type { Locale } from '../constants';

type Dictionary = Record<string, string>;

const zhCN: Dictionary = {
  'welcome.title': '欢迎来到 Cardhub',
  'welcome.subtitle': '权威、集中的卡牌知识分享平台',
  'welcome.cta.browse': '浏览全部系列',
  'welcome.cta.search': '直接搜索卡牌',
  'health.ok': '后端连接正常',
  'health.fail': '后端连接失败',
  'nav.home': '首页',
  'nav.series': '系列',
  'nav.search': '搜索',
  'nav.login': '登录',
  'nav.register': '注册',
  'nav.logout': '退出登录',
  'breadcrumb.home': '首页',
  'breadcrumb.series': '系列',
  'breadcrumb.cards': '卡牌',
  'series.list.title': '所有系列',
  'series.list.subtitle': '探索 Cardhub 收录的全部卡牌系列',
  'series.cardCount': '收录 {count} 张卡牌',
  'series.empty': '暂无系列数据',
  'series.detail.cardsTitle': '本系列卡牌',
  'card.detail.attributes': '属性',
  'card.detail.rarity': '稀有度',
  'card.detail.series': '所属系列',
  'card.detail.commentsTitle': '评论区',
  'card.detail.commentsPlaceholder': '评论功能即将上线（详见 Epic 3）',
  'card.detail.loginToComment': '登录后即可发表评论',
  'card.detail.commentSubmit': '发布评论',
  'card.detail.commentEmpty': '还没有评论，来抢沙发吧',
  'search.placeholder': '搜索卡牌…',
  'search.empty': '没有匹配的卡牌',
  'search.results': '搜索结果',
  'search.results.title': '关于 “{query}” 的搜索结果',
  'state.loading': '加载中…',
  'state.error': '加载失败',
  'state.notFound': '内容不存在',
  'state.retry': '重试',
};

const enUS: Dictionary = {
  'welcome.title': 'Welcome to Cardhub',
  'welcome.subtitle': 'A central, authoritative card knowledge platform',
  'welcome.cta.browse': 'Browse all series',
  'welcome.cta.search': 'Search cards directly',
  'health.ok': 'Backend reachable',
  'health.fail': 'Backend unreachable',
  'nav.home': 'Home',
  'nav.series': 'Series',
  'nav.search': 'Search',
  'nav.login': 'Sign in',
  'nav.register': 'Sign up',
  'nav.logout': 'Sign out',
  'breadcrumb.home': 'Home',
  'breadcrumb.series': 'Series',
  'breadcrumb.cards': 'Cards',
  'series.list.title': 'All series',
  'series.list.subtitle': 'Explore every card series indexed in Cardhub',
  'series.cardCount': '{count} cards inside',
  'series.empty': 'No series yet',
  'series.detail.cardsTitle': 'Cards in this series',
  'card.detail.attributes': 'Attributes',
  'card.detail.rarity': 'Rarity',
  'card.detail.series': 'Series',
  'card.detail.commentsTitle': 'Comments',
  'card.detail.commentsPlaceholder': 'Comments are coming with Epic 3',
  'card.detail.loginToComment': 'Sign in to leave a comment',
  'card.detail.commentSubmit': 'Post comment',
  'card.detail.commentEmpty': 'No comments yet — be the first to chime in',
  'search.placeholder': 'Search cards…',
  'search.empty': 'No matching cards',
  'search.results': 'Search results',
  'search.results.title': 'Results for “{query}”',
  'state.loading': 'Loading…',
  'state.error': 'Failed to load',
  'state.notFound': 'Not found',
  'state.retry': 'Retry',
};

export const dictionaries: Record<Locale, Dictionary> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = dictionaries[locale]?.[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}
