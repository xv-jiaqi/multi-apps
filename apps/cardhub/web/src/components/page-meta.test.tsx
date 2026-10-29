import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageMeta } from './page-meta';

function description() {
  return document.querySelector('meta[name="description"]');
}

describe('PageMeta', () => {
  it('keeps the title format and omits a missing description', () => {
    render(<PageMeta title="系列" />);

    expect(document.title).toBe('系列 · Cardhub');
    expect(description()).toBeNull();
  });

  it('renders the description beside the same title', () => {
    render(
      <PageMeta
        title="皮卡丘"
        description="皮卡丘 · 基础系列 No.58。在 Cardhub 查看卡牌资料、交易和讨论。"
      />,
    );

    expect(document.title).toBe('皮卡丘 · Cardhub');
    expect(description()).toHaveAttribute(
      'content',
      '皮卡丘 · 基础系列 No.58。在 Cardhub 查看卡牌资料、交易和讨论。',
    );
  });

  it('omits a blank description', () => {
    render(<PageMeta title="系列" description="   " />);

    expect(document.title).toBe('系列 · Cardhub');
    expect(description()).toBeNull();
  });
});
