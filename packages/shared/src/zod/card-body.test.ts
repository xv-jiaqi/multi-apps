import { describe, expect, it } from 'vitest';
import '../configure-zod';
import { fieldErrorMessage } from '../i18n';
import { CARD_BODY_MAX, adminCardUpsertInput } from './index';

const card = {
  slug: 'base-card',
  name: '基础卡',
  rarity: 'common',
  seriesSlug: 'dawn-set',
};

describe('card body input', () => {
  it('accepts an omitted body, a cleared body, and a trimmed markdown string', () => {
    expect(adminCardUpsertInput.parse(card).body).toBeUndefined();
    expect(adminCardUpsertInput.parse({ ...card, body: null }).body).toBeNull();
    expect(adminCardUpsertInput.parse({ ...card, body: '  ## 说明  ' }).body).toBe('## 说明');
    expect(
      adminCardUpsertInput.parse({ ...card, body: '卡'.repeat(CARD_BODY_MAX) }).body,
    ).toHaveLength(CARD_BODY_MAX);
  });

  it('uses card_body_too_long when the markdown exceeds 20000 characters', () => {
    const parsed = adminCardUpsertInput.safeParse({
      ...card,
      body: '卡'.repeat(CARD_BODY_MAX + 1),
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.find((issue) => issue.path[0] === 'body')?.message).toBe(
      'card_body_too_long',
    );
    expect(fieldErrorMessage('zh-CN', 'card_body_too_long')).toBe('长描述最多 20000 个字符');
    expect(fieldErrorMessage('en-US', 'card_body_too_long')).toBe(
      'Use at most 20000 characters for the long description.',
    );
  });
});
