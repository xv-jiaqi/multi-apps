import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../styles/globals.css';

vi.mock('../lib/trpc', () => ({ clearActiveQueryClient: vi.fn(), trpc: {} }));

import { SelectField } from './trade-publish';

// Resolve any CSS color (oklch included) to #rrggbb through a canvas.
function toHex(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('')}`;
}

function renderCurrency(invalid?: boolean) {
  render(
    <SelectField
      label="货币"
      value="CNY"
      onValueChange={() => {}}
      options={[{ value: 'CNY', label: 'CNY' }]}
      invalid={invalid}
      error={invalid ? '请选择货币' : undefined}
      errorId="trade-currency-error"
    />,
  );
  return screen.getByRole('combobox', { name: '货币' });
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

describe('SelectField error border', () => {
  it.each([
    ['light', false, '#e7000b'],
    ['dark', true, '#fb2c36'],
  ] as const)('uses danger-line on the trigger in %s mode', (_mode, dark, hex) => {
    if (dark) document.documentElement.classList.add('dark');
    const trigger = renderCurrency(true);
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', 'trade-currency-error');
    expect(trigger).toHaveAccessibleDescription('请选择货币');
    expect(toHex(getComputedStyle(trigger).borderTopColor)).toBe(hex);
  });

  it('keeps the normal border when valid', () => {
    const trigger = renderCurrency();
    expect(trigger).not.toHaveAttribute('aria-invalid');
    expect(toHex(getComputedStyle(trigger).borderTopColor)).not.toBe('#e7000b');
  });
});
