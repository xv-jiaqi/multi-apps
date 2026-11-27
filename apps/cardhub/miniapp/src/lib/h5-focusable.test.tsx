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

  it('forwards kebab-case aria-checked, aria-label, id and style onto the native button', () => {
    const view = render(
      <FocusableButton
        id="reason-sell"
        style={{ marginTop: 8 }}
        {...{ 'aria-checked': true, 'aria-label': '出' }}
      >
        出
      </FocusableButton>,
    );
    const button = view.container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('id')).toBe('reason-sell');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('出');
    expect(button.style.marginTop).toBe('8px');
  });

  it('uses a hash href on H5 so a new tab does not 404', () => {
    const view = render(<Link to="/pages/forum/new/index">发帖</Link>);
    const link = view.container.querySelector('a.h5-focusable-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#/pages/forum/new/index');
  });

  it('forwards camelCase aria-label and aria-checked', () => {
    const view = render(
      <FocusableButton role="radio" ariaLabel="骚扰或人身攻击" ariaChecked>
        骚扰或人身攻击
      </FocusableButton>,
    );
    const button = view.container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('骚扰或人身攻击');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.getAttribute('role')).toBe('radio');
  });

  it('honors tabIndex and onKeyDown so a radiogroup can move focus', () => {
    const onKeyDown = vi.fn();
    const view = render(
      <FocusableButton role="radio" tabIndex={-1} onKeyDown={onKeyDown}>
        垃圾信息
      </FocusableButton>,
    );
    const button = view.container.querySelector('button') as HTMLButtonElement;
    expect(button.tabIndex).toBe(-1);
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('blocks clicks when only aria-disabled is set', () => {
    const onClick = vi.fn();
    const view = render(
      <FocusableButton aria-disabled={true} onClick={onClick}>
        删除
      </FocusableButton>,
    );
    const button = view.container.querySelector('button') as HTMLButtonElement;
    expect(button.tabIndex).toBe(-1);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
