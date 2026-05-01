import type { Locale } from '../constants';

type Dictionary = Record<string, string>;

const zhCN: Dictionary = {
  'welcome.title': '欢迎来到 Cardhub',
  'welcome.subtitle': '权威、集中的卡牌知识分享平台',
  'health.ok': '后端连接正常',
  'health.fail': '后端连接失败',
};

const enUS: Dictionary = {
  'welcome.title': 'Welcome to Cardhub',
  'welcome.subtitle': 'A central, authoritative card knowledge platform',
  'health.ok': 'Backend reachable',
  'health.fail': 'Backend unreachable',
};

export const dictionaries: Record<Locale, Dictionary> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export function t(locale: Locale, key: string): string {
  return dictionaries[locale]?.[key] ?? key;
}
