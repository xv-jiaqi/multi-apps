// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tarojs/components', () => import('../../test-stubs/taro-dom'));

vi.mock('@tarojs/taro', () => ({
  default: { getEnv: () => 'WEB' },
  getEnv: () => 'WEB',
}));

import { FocusableButton } from './index';

describe('FocusableButton aria props', () => {
  it('renders aria-label and aria-checked from camelCase props', () => {
    const { container } = render(
      <FocusableButton role="radio" ariaLabel="骚扰或人身攻击" ariaChecked>
        骚扰或人身攻击
      </FocusableButton>,
    );
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('骚扰或人身攻击');
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('renders aria-label and aria-checked when Taro rewrites props to kebab-case', () => {
    const { container } = render(
      <FocusableButton
        role="radio"
        {...({
          'aria-label': '骚扰或人身攻击',
          'aria-checked': true,
        } as Record<string, unknown>)}
      >
        骚扰或人身攻击
      </FocusableButton>,
    );
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('骚扰或人身攻击');
    expect(btn.getAttribute('aria-checked')).toBe('true');
    expect(btn.getAttribute('role')).toBe('radio');
  });
});
