// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const taro = vi.hoisted(() => ({
  getEnv: vi.fn(() => 'WEB'),
  ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' },
  navigateTo: vi.fn(async () => undefined),
  redirectTo: vi.fn(async () => undefined),
  switchTab: vi.fn(async () => undefined),
  navigateBack: vi.fn(async () => undefined),
}));

vi.mock('@tarojs/taro', () => ({ default: taro, ...taro }));
vi.mock('@tarojs/components', () => import('../test-stubs/taro-dom'));

import { FocusableButton, Link, PrimaryButton } from '@repo/ui-mini';

afterEach(() => {
  cleanup();
  taro.navigateTo.mockClear();
});

describe('H5 focusable controls (CH-301 §5)', () => {
  it('renders PrimaryButton as a tabbable native button', () => {
    const onClick = vi.fn();
    const view = render(<PrimaryButton label="发布新话题" onClick={onClick} />);
    const button = view.container.querySelector('button.primary-button') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.tagName).toBe('BUTTON');
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('role') ?? button.role ?? 'button').toBe('button');
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it('keeps a disabled PrimaryButton out of the tab order', () => {
    const onClick = vi.fn();
    const view = render(<PrimaryButton label="正在发布…" disabled onClick={onClick} />);
    const button = view.container.querySelector('button.primary-button') as HTMLButtonElement;
    expect(button.tabIndex).toBe(-1);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders Link as a tabbable anchor that activates on Enter and Space', () => {
    const view = render(<Link to="/pages/forum/new/index">发帖</Link>);
    const link = view.container.querySelector('a.h5-focusable-link') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.tabIndex).toBe(0);
    expect(link.getAttribute('role')).toBe('link');
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/forum/new/index' });
    taro.navigateTo.mockClear();
    fireEvent.keyDown(link, { key: ' ' });
    expect(taro.navigateTo).toHaveBeenCalledWith({ url: '/pages/forum/new/index' });
  });

  it('exposes FocusableButton for page-level actions with aria-pressed', () => {
    const onClick = vi.fn();
    const view = render(
      <FocusableButton className="trade-filters__chip" aria-pressed={true} onClick={onClick}>
        全部
      </FocusableButton>,
    );
    const button = view.getByRole('button', { name: '全部' }) as HTMLButtonElement;
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });
});
