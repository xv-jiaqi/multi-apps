import { describe, expect, it } from 'vitest';
import { appErrorMessage, t } from './index';

const counts = [0, 1, 2] as const;

function searchSummary(locale: 'zh-CN' | 'en-US', cards: number, series: number): string {
  return t(locale, 'search.resultsSummary', {
    cards: t(locale, 'search.summary.cards', { count: cards }),
    series: t(locale, 'search.summary.series', { count: series }),
    results: t(locale, 'form.resultsCount', { count: cards + series }),
  });
}

describe('app error copy', () => {
  it('maps a known code and hides unknown codes behind the generic sentence', () => {
    expect(appErrorMessage('zh-CN', 'VALIDATION')).toBe('填写的内容不符合要求，请修改后再试');
    expect(appErrorMessage('en-US', 'VALIDATION')).toBe(
      'Some fields need to be changed before you can continue.',
    );
    expect(appErrorMessage('zh-CN', 'NOT_A_REAL_CODE')).toBe('出了点问题，请稍后再试');
    expect(appErrorMessage('zh-CN', undefined)).toBe('出了点问题，请稍后再试');
    expect(appErrorMessage('zh-CN', 'VALIDATION')).not.toContain('VALIDATION');
    expect(appErrorMessage('en-US', 'INTERNAL_SERVER_ERROR')).toBe(
      'Something went wrong. Try again later.',
    );
    expect(appErrorMessage('en-US', 'UNKNOWN')).toBe('Something went wrong. Try again later.');
    expect(appErrorMessage('zh-CN', 'UNKNOWN')).toBe(
      appErrorMessage('zh-CN', 'INTERNAL_SERVER_ERROR'),
    );
    expect(appErrorMessage('en-US', 'NOT_A_REAL_CODE')).toBe(
      'Something went wrong. Try again later.',
    );
    expect(appErrorMessage('en-US', undefined)).toBe('Something went wrong. Try again later.');
    expect(appErrorMessage('en-US', 'NOT_A_REAL_CODE')).not.toContain('出了点问题');
  });
});

describe('search result plurals', () => {
  it('uses one result for 1 and results for 0 and 2 in English', () => {
    expect(t('en-US', 'form.resultsCount', { count: 0 })).toBe('0 results');
    expect(t('en-US', 'form.resultsCount', { count: 1 })).toBe('1 result');
    expect(t('en-US', 'form.resultsCount', { count: 2 })).toBe('2 results');
  });

  it('keeps the Chinese result sentence for 0, 1, and 2', () => {
    for (const count of counts) {
      expect(t('zh-CN', 'form.resultsCount', { count })).toBe(`找到 ${count} 条结果`);
    }
  });

  it('pluralizes the /search summary in English and keeps the Chinese sentence', () => {
    expect(searchSummary('en-US', 0, 0)).toBe('0 results. Found 0 cards and 0 series.');
    expect(searchSummary('en-US', 1, 0)).toBe('1 result. Found 1 card and 0 series.');
    expect(searchSummary('en-US', 2, 1)).toBe('3 results. Found 2 cards and 1 series.');
    expect(searchSummary('zh-CN', 0, 0)).toBe('找到 0 张卡牌、0 个系列');
    expect(searchSummary('zh-CN', 1, 0)).toBe('找到 1 张卡牌、0 个系列');
    expect(searchSummary('zh-CN', 2, 1)).toBe('找到 2 张卡牌、1 个系列');
  });
});

describe('other count copy', () => {
  it('pluralizes English nouns that agree with {count}', () => {
    expect(t('en-US', 'series.cardCount', { count: 1 })).toBe('1 card inside');
    expect(t('en-US', 'series.cardCount', { count: 0 })).toBe('0 cards inside');
    expect(t('en-US', 'series.cardCount', { count: 2 })).toBe('2 cards inside');

    expect(t('en-US', 'forum.list.replyCount', { count: 1 })).toBe('1 reply');
    expect(t('en-US', 'forum.list.replyCount', { count: 2 })).toBe('2 replies');

    expect(t('en-US', 'forum.detail.repliesTitle', { count: 1 })).toBe('Reply (1)');
    expect(t('en-US', 'forum.detail.repliesTitle', { count: 0 })).toBe('Replies (0)');

    expect(t('en-US', 'forum.detail.repliesLoaded', { count: 1 })).toBe('Loaded 1 reply');
    expect(t('en-US', 'forum.detail.repliesLoaded', { count: 2 })).toBe('Loaded 2 replies');

    expect(t('en-US', 'search.cardsHeading', { count: 1 })).toBe('Card (1)');
    expect(t('en-US', 'search.cardsHeading', { count: 2 })).toBe('Cards (2)');
    expect(t('en-US', 'search.seriesHeading', { count: 1 })).toBe('Series (1)');

    expect(t('en-US', 'admin.users.total', { count: 1 })).toBe('1 user');
    expect(t('en-US', 'admin.users.total', { count: 0 })).toBe('0 users');
    expect(t('en-US', 'admin.users.total', { count: 2 })).toBe('2 users');
    expect(t('zh-CN', 'admin.users.total', { count: 1 })).toBe('共 1 位用户');
    expect(t('zh-CN', 'admin.users.total', { count: 2 })).toBe('共 2 位用户');

    expect(t('en-US', 'admin.count.cards', { count: 1 })).toBe('1 card');
    expect(t('en-US', 'admin.count.comments', { count: 0 })).toBe('0 comments');
    expect(t('en-US', 'admin.count.seriesComments', { count: 2 })).toBe('2 series comments');

    expect(t('en-US', 'admin.attrs.atLimit', { count: 1, max: 40 })).toBe(
      'This card has 1 attribute (limit 40)',
    );
    expect(t('en-US', 'admin.attrs.atLimit', { count: 2, max: 40 })).toBe(
      'This card has 2 attributes (limit 40)',
    );
    expect(t('en-US', 'admin.import.blocked', { count: 1 })).toBe('Fix 1 error before importing');
    expect(t('en-US', 'admin.import.blocked', { count: 2 })).toBe('Fix 2 errors before importing');
    expect(t('en-US', 'admin.import.summary.errors', { count: 1 })).toBe('1 error');
    expect(t('en-US', 'admin.import.summary.cards', { count: 1 })).toBe('1 new card');
    expect(t('en-US', 'trade.filter.toggleCount', { count: 1 })).toBe('Filter & sort (1)');
    expect(t('en-US', 'trade.filter.toggleCount', { count: 2 })).toBe('Filters & sort (2)');
  });

  it('keeps Chinese count sentences the same for 0, 1, and 2', () => {
    for (const count of counts) {
      expect(t('zh-CN', 'series.cardCount', { count })).toBe(`收录 ${count} 张卡牌`);
      expect(t('zh-CN', 'forum.list.replyCount', { count })).toBe(`${count} 条回帖`);
      expect(t('zh-CN', 'forum.detail.repliesTitle', { count })).toBe(`回帖（${count}）`);
      expect(t('zh-CN', 'forum.detail.repliesLoaded', { count })).toBe(`已加载 ${count} 条回帖`);
      expect(t('zh-CN', 'search.cardsHeading', { count })).toBe(`卡牌（${count}）`);
      expect(t('zh-CN', 'search.seriesHeading', { count })).toBe(`系列（${count}）`);
      expect(t('zh-CN', 'admin.count.cards', { count })).toBe(`${count} 张卡牌`);
      expect(t('zh-CN', 'admin.count.comments', { count })).toBe(`${count} 条评论`);
      expect(t('zh-CN', 'admin.attrs.atLimit', { count, max: 40 })).toBe(
        `已有 ${count} 个属性，最多 40 个`,
      );
      expect(t('zh-CN', 'admin.import.blocked', { count })).toBe(
        `有 ${count} 处错误，修正后才能导入`,
      );
      expect(t('zh-CN', 'trade.filter.toggleCount', { count })).toBe(`筛选与排序（${count}）`);
    }
  });
});
