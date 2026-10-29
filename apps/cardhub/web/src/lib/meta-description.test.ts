import { describe, expect, it } from 'vitest';
import type { Locale } from '@repo/shared';
import { cardMetaDescription, seriesMetaDescription } from './meta-description';

const ZH_SERIES = '基础系列 系列，共 2 张卡牌。在 Cardhub 查看卡牌资料和讨论。';
const ZH_SERIES_NO_COUNT = '基础系列 系列。在 Cardhub 查看卡牌资料和讨论。';
const EN_SERIES = 'Base Set: 2 cards. See card details and discussion on Cardhub.';
const EN_SERIES_NO_COUNT = 'Base Set. See card details and discussion on Cardhub.';
const ZH_CARD = '皮卡丘 · 基础系列 No.58。在 Cardhub 查看卡牌资料、交易和讨论。';
const ZH_CARD_NO_NUMBER = '皮卡丘 · 基础系列。在 Cardhub 查看卡牌资料、交易和讨论。';
const EN_CARD = 'Pikachu from Base Set, No. 58. See details, trades, and discussion on Cardhub.';
const EN_CARD_NO_NUMBER = 'Pikachu from Base Set. See details, trades, and discussion on Cardhub.';

function graphemeLength(text: string, locale: Locale): number {
  return [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)].length;
}

function excerptAfter(content: string, template: string): string {
  expect(content.startsWith(`${template} `)).toBe(true);
  return content.slice(template.length + 1);
}

describe('series and card meta descriptions', () => {
  it('uses the series and card templates in the active language', () => {
    expect(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 2,
        description: null,
      }),
    ).toBe(ZH_SERIES);
    expect(
      seriesMetaDescription({
        locale: 'en-US',
        title: 'Base Set',
        cardCount: 2,
        description: null,
      }),
    ).toBe(EN_SERIES);
    expect(
      cardMetaDescription({
        locale: 'zh-CN',
        name: '皮卡丘',
        seriesTitle: '基础系列',
        cardNumber: '58',
        description: null,
      }),
    ).toBe(ZH_CARD);
    expect(
      cardMetaDescription({
        locale: 'en-US',
        name: 'Pikachu',
        seriesTitle: 'Base Set',
        cardNumber: '58',
        description: null,
      }),
    ).toBe(EN_CARD);
  });

  it('keeps the zero-card sentence', () => {
    expect(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 0,
        description: null,
      }),
    ).toBe('基础系列 系列，共 0 张卡牌。在 Cardhub 查看卡牌资料和讨论。');
    expect(
      seriesMetaDescription({
        locale: 'en-US',
        title: 'Base Set',
        cardCount: 0,
        description: null,
      }),
    ).toBe('Base Set: 0 cards. See card details and discussion on Cardhub.');
  });

  it('uses the English singular when the series has one card', () => {
    expect(
      seriesMetaDescription({
        locale: 'en-US',
        title: 'Base Set',
        cardCount: 1,
        description: null,
      }),
    ).toBe('Base Set: 1 card. See card details and discussion on Cardhub.');
    expect(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 1,
        description: null,
      }),
    ).toBe('基础系列 系列，共 1 张卡牌。在 Cardhub 查看卡牌资料和讨论。');
  });

  it('uses the English plural when the series has two cards', () => {
    expect(
      seriesMetaDescription({
        locale: 'en-US',
        title: 'Base Set',
        cardCount: 2,
        description: null,
      }),
    ).toBe('Base Set: 2 cards. See card details and discussion on Cardhub.');
  });

  it('omits the card number and its prefix when the number is missing', () => {
    for (const cardNumber of [null, undefined, '', '   ']) {
      expect(
        cardMetaDescription({
          locale: 'zh-CN',
          name: '皮卡丘',
          seriesTitle: '基础系列',
          cardNumber,
          description: null,
        }),
      ).toBe(ZH_CARD_NO_NUMBER);
      expect(
        cardMetaDescription({
          locale: 'en-US',
          name: 'Pikachu',
          seriesTitle: 'Base Set',
          cardNumber,
          description: null,
        }),
      ).toBe(EN_CARD_NO_NUMBER);
    }
  });

  it('uses the no-count sentence when the series card count is unavailable', () => {
    for (const cardCount of [null, undefined]) {
      expect(
        seriesMetaDescription({
          locale: 'zh-CN',
          title: '基础系列',
          cardCount,
          description: null,
        }),
      ).toBe(ZH_SERIES_NO_COUNT);
      expect(
        seriesMetaDescription({
          locale: 'en-US',
          title: 'Base Set',
          cardCount,
          description: null,
        }),
      ).toBe(EN_SERIES_NO_COUNT);
    }
  });

  it('appends a description after the template and leaves the template whole', () => {
    expect(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 2,
        description: '黎明。',
      }),
    ).toBe(`${ZH_SERIES} 黎明。`);
    expect(
      cardMetaDescription({
        locale: 'en-US',
        name: 'Pikachu',
        seriesTitle: 'Base Set',
        cardNumber: '58',
        description: 'A mouse.',
      }),
    ).toBe(`${EN_CARD} A mouse.`);
  });

  it('turns Markdown into plain text before measuring the excerpt', () => {
    const fenced = `\`\`\`\n${'x'.repeat(400)}\n\`\`\`\n可见短句。`;
    expect(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 2,
        description: fenced,
      }),
    ).toBe(`${ZH_SERIES} 可见短句。`);

    const linked = '看**这张**[卡牌](https://example.com/cards/pikachu)就好。';
    const content = cardMetaDescription({
      locale: 'zh-CN',
      name: '皮卡丘',
      seriesTitle: '基础系列',
      cardNumber: '58',
      description: linked,
    });
    expect(content).toBe(`${ZH_CARD} 看这张卡牌就好。`);
    expect(content).not.toContain('**');
    expect(content).not.toContain('https://');
  });

  it('uses the template alone when Markdown has no visible text', () => {
    expect(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 2,
        description: '```\nonly code\n```\n![alt](https://example.com/a.png)',
      }),
    ).toBe(ZH_SERIES);
    expect(
      cardMetaDescription({
        locale: 'en-US',
        name: 'Pikachu',
        seriesTitle: 'Base Set',
        cardNumber: null,
        description: '   ',
      }),
    ).toBe(EN_CARD_NO_NUMBER);
  });

  it('keeps the whole meta content at the locale limit, template included', () => {
    const zhRoom = 120 - graphemeLength(ZH_SERIES, 'zh-CN') - 1;
    const zhExact = '字'.repeat(zhRoom);
    const zhFit = seriesMetaDescription({
      locale: 'zh-CN',
      title: '基础系列',
      cardCount: 2,
      description: zhExact,
    });
    expect(zhFit).toBe(`${ZH_SERIES} ${zhExact}`);
    expect(graphemeLength(zhFit, 'zh-CN')).toBe(120);
    expect(zhFit.endsWith('…')).toBe(false);

    const zhOver = seriesMetaDescription({
      locale: 'zh-CN',
      title: '基础系列',
      cardCount: 2,
      description: '字'.repeat(zhRoom + 1),
    });
    expect(zhOver.startsWith(`${ZH_SERIES} `)).toBe(true);
    expect(zhOver.endsWith('…')).toBe(true);
    expect(graphemeLength(zhOver, 'zh-CN')).toBe(120);
    expect('字'.repeat(zhRoom + 1).startsWith(zhOver.slice(ZH_SERIES.length + 1, -1))).toBe(true);

    const enRoom = 155 - graphemeLength(EN_SERIES, 'en-US') - 1;
    const enExact = 'a'.repeat(enRoom);
    const enFit = seriesMetaDescription({
      locale: 'en-US',
      title: 'Base Set',
      cardCount: 2,
      description: enExact,
    });
    expect(enFit).toBe(`${EN_SERIES} ${enExact}`);
    expect(graphemeLength(enFit, 'en-US')).toBe(155);

    const enOver = seriesMetaDescription({
      locale: 'en-US',
      title: 'Base Set',
      cardCount: 2,
      description: 'a'.repeat(enRoom + 1),
    });
    expect(enOver.startsWith(`${EN_SERIES} `)).toBe(true);
    expect(enOver.endsWith('…')).toBe(true);
    expect(graphemeLength(enOver, 'en-US')).toBe(155);
  });

  it('drops the description when the cut leaves fewer than 10 graphemes', () => {
    expect(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 2,
        description: `短。${'后续文字'.repeat(40)}`,
      }),
    ).toBe(ZH_SERIES);

    const kept = seriesMetaDescription({
      locale: 'zh-CN',
      title: '基础系列',
      cardCount: 2,
      description: `这是一个完整的第一句。${'后面还有很多'.repeat(20)}`,
    });
    expect(kept).toBe(`${ZH_SERIES} 这是一个完整的第一句。…`);
    expect(graphemeLength(excerptAfter(kept, ZH_SERIES), 'zh-CN')).toBeGreaterThanOrEqual(10);
    expect(graphemeLength(kept, 'zh-CN')).toBeLessThanOrEqual(120);
  });

  it('uses the English limit for a Chinese description when the UI is English', () => {
    const description = '字'.repeat(200);
    const english = seriesMetaDescription({
      locale: 'en-US',
      title: 'Base Set',
      cardCount: 2,
      description,
    });
    const chinese = seriesMetaDescription({
      locale: 'zh-CN',
      title: '基础系列',
      cardCount: 2,
      description,
    });
    expect(graphemeLength(english, 'en-US')).toBeGreaterThan(120);
    expect(graphemeLength(english, 'en-US')).toBeLessThanOrEqual(155);
    expect(graphemeLength(chinese, 'zh-CN')).toBe(120);
    expect(excerptAfter(english, EN_SERIES)).toMatch(/^字+…$/u);
    expect(english).not.toBe(chinese);
  });

  it('prefers a finished sentence, otherwise a whole word, and does not end on a broken mark', () => {
    const words = '词语'.repeat(80);
    const wordExcerpt = excerptAfter(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 2,
        description: words,
      }),
      ZH_SERIES,
    );
    expect(wordExcerpt.endsWith('…')).toBe(true);
    expect(wordExcerpt.slice(0, -1).endsWith('词语')).toBe(true);
    expect(graphemeLength(`${ZH_SERIES} ${wordExcerpt}`, 'zh-CN')).toBeLessThanOrEqual(120);

    const english = `Short sentence. ${'Word '.repeat(80)}`;
    expect(
      seriesMetaDescription({
        locale: 'en-US',
        title: 'Base Set',
        cardCount: 2,
        description: english,
      }),
    ).toBe(`${EN_SERIES} Short sentence.…`);

    const commas = Array.from({ length: 40 }, () => 'hello').join(', ');
    const commaContent = cardMetaDescription({
      locale: 'en-US',
      name: 'Pikachu',
      seriesTitle: 'Base Set',
      cardNumber: '58',
      description: commas,
    });
    const commaExcerpt = excerptAfter(commaContent, EN_CARD);
    expect(commaExcerpt.endsWith('…')).toBe(true);
    expect(commaExcerpt).not.toMatch(/[,，、；;:：]\s*…$/u);
    expect(commaExcerpt.slice(0, -1).endsWith('hello')).toBe(true);
    expect(graphemeLength(commaContent, 'en-US')).toBeLessThanOrEqual(155);

    const family = '👨‍👩‍👧‍👦';
    const emojiExcerpt = excerptAfter(
      seriesMetaDescription({
        locale: 'zh-CN',
        title: '基础系列',
        cardCount: 2,
        description: family.repeat(150),
      }),
      ZH_SERIES,
    );
    expect(emojiExcerpt.endsWith('…')).toBe(true);
    expect(emojiExcerpt.slice(0, -1).split(family).join('')).toBe('');
    expect(graphemeLength(`${ZH_SERIES} ${emojiExcerpt}`, 'zh-CN')).toBeLessThanOrEqual(120);
  });
});
