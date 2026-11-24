import { describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => ({
  Button: function Button() {
    return null;
  },
  Text: function Text() {
    return null;
  },
  View: function View() {
    return null;
  },
}));

import { ErrorBoxMini } from './index';

function buttonOf(el: { props: { children: unknown } }) {
  const kids = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
  return kids.find((k) => k && (k as { type?: { name?: string } }).type?.name === 'Button') as {
    props: Record<string, unknown>;
  };
}

describe('ErrorBoxMini retry button (Taro H5 disabled click)', () => {
  it('does not pass onClick and sets aria-disabled while retrying', () => {
    const onRetry = vi.fn();
    const el = ErrorBoxMini({
      title: '系列加载失败',
      retryLabel: '重试',
      retryingLabel: '重试中…',
      retrying: true,
      onRetry,
    });
    const btn = buttonOf(el);
    expect(btn.props.onClick).toBeUndefined();
    const aria = btn.props.ariaDisabled ?? btn.props['aria-disabled'];
    expect(aria === true || aria === 'true').toBe(true);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('passes onClick when not retrying', () => {
    const onRetry = vi.fn();
    const el = ErrorBoxMini({
      title: '系列加载失败',
      retryLabel: '重试',
      retryingLabel: '重试中…',
      retrying: false,
      onRetry,
    });
    const btn = buttonOf(el);
    expect(btn.props.onClick).toBeTypeOf('function');
    (btn.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(btn.props.ariaDisabled ?? btn.props['aria-disabled']).toBeFalsy();
  });
});
