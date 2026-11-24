import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@tarojs/components', () => ({
  Button: function Button() {
    return null;
  },
}));

import { PrimaryButton } from '../../../../../packages/ui-mini/src/components/primary-button';

const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

describe('PrimaryButton disabled prop (CH-301 §5 / Taro H5)', () => {
  it('does not pass disabled or a disabled class when disabled is false', () => {
    const el = PrimaryButton({ label: '登录', disabled: false });
    expect(el.props.disabled).toBeUndefined();
    expect(String(el.props.className ?? '')).not.toMatch(/primary-button--disabled/);
    expect(String(el.props.className ?? '')).not.toMatch(/button-disabled/);
  });

  it('passes disabled and primary-button--disabled only when disabled is true', () => {
    const el = PrimaryButton({ label: '登录', disabled: true });
    expect(el.props.disabled).toBe(true);
    expect(String(el.props.className ?? '')).toMatch(/primary-button--disabled/);
  });

  it('omits disabled when the prop is not passed', () => {
    const el = PrimaryButton({ label: '浏览系列' });
    expect(el.props.disabled).toBeUndefined();
    expect(String(el.props.className ?? '')).not.toMatch(/primary-button--disabled/);
  });

  it('hangs disabled visual styles on a class, not [disabled], so disabled="false" cannot match', () => {
    const scss = readFileSync(path.join(srcDir, 'app.scss'), 'utf8');
    const code = scss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const disabledBlock =
      /\.primary-button--disabled[\s\S]*?\{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
    expect(disabledBlock).toMatch(/background-color:\s*\$color-neutral-100/);
    expect(disabledBlock).toMatch(/color:\s*\$color-neutral-600/);
    expect(code).toMatch(/\.button-disabled/);
    expect(code).not.toMatch(/primary-button[^\n{]*\[disabled\]/);
  });
});
