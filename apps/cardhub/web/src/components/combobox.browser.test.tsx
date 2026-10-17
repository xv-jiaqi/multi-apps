import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { Combobox } from '@repo/ui-web';

const labels = {
  empty: 'No results',
  loading: 'Loading',
  error: 'Search failed',
  retry: 'Retry',
  clear: 'Clear',
  resultsCount: (count: number) => `${count} results`,
};

interface Item {
  id: string;
  name: string;
}

const alpha = { id: 'alpha', name: 'Alpha' };
const beta = { id: 'beta', name: 'Beta' };

function ComboHarness({
  groups = [{ key: 'cards', label: 'Cards', items: [alpha, beta] }],
  initialValue = null,
}: {
  groups?: Array<{ key: string; label?: string; items: Item[] }>;
  initialValue?: Item | null;
}) {
  const [query, setQuery] = useState('');
  const [value, setValue] = useState<Item | null>(initialValue);
  const [cleared, setCleared] = useState(false);

  return (
    <>
      <output data-testid="selected">{value?.id ?? '-'}</output>
      <output data-testid="cleared">{cleared ? 'yes' : 'no'}</output>
      <Combobox
        mode="select"
        value={value}
        onValueChange={(item) => {
          setValue(item);
          setCleared(item == null);
        }}
        inputValue={query}
        onInputValueChange={setQuery}
        groups={groups}
        getKey={(item) => item.id}
        renderItem={(item) => <span>{item.name}</span>}
        getItemText={(item) => item.name}
        status="success"
        labels={labels}
        placeholder="Search cards"
      />
    </>
  );
}

function input() {
  return screen.getByRole('combobox') as HTMLInputElement;
}

afterEach(() => {
  cleanup();
});

describe('Combobox keyboard in Chromium', () => {
  it('closes on the first Escape and clears on the second', async () => {
    render(<ComboHarness />);

    await userEvent.click(input());
    await userEvent.keyboard('for');

    await expect.poll(() => screen.queryByRole('listbox')).toBeTruthy();
    await expect.poll(() => input().value).toBe('for');

    await userEvent.keyboard('{Escape}');

    await expect.poll(() => screen.queryByRole('listbox')).toBeNull();
    await expect.poll(() => input().value).toBe('for');
    await expect.poll(() => input().getAttribute('aria-expanded')).toBe('false');
    await expect.poll(() => document.activeElement).toBe(input());

    await userEvent.keyboard('{Escape}');

    await expect.poll(() => input().value).toBe('');
  });

  it('restores the selected value when Escape cancels an edit', async () => {
    render(<ComboHarness initialValue={alpha} />);

    await expect.poll(() => input().value).toBe('Alpha');
    expect(screen.getByTestId('selected')).toHaveTextContent('alpha');

    await userEvent.click(input());
    await userEvent.keyboard('{End}x');

    await expect.poll(() => input().value).toBe('Alphax');
    await expect.poll(() => screen.queryByRole('listbox')).toBeTruthy();

    await userEvent.keyboard('{Escape}');

    await expect.poll(() => screen.queryByRole('listbox')).toBeNull();
    await expect.poll(() => input().value).toBe('Alpha');
    expect(screen.getByTestId('selected')).toHaveTextContent('alpha');
    expect(screen.getByTestId('cleared')).toHaveTextContent('no');
  });

  it('returns the highlight to the input after ArrowDown on the last option', async () => {
    render(<ComboHarness />);

    await userEvent.click(input());
    await userEvent.keyboard('ab');
    await expect.poll(() => screen.queryByRole('listbox')).toBeTruthy();
    expect(input()).not.toHaveAttribute('aria-activedescendant');

    await userEvent.keyboard('{ArrowDown}');
    await expect
      .poll(() => input().getAttribute('aria-activedescendant') ?? '')
      .toMatch(/-option-0$/);
    await userEvent.keyboard('{ArrowDown}');
    await expect
      .poll(() => input().getAttribute('aria-activedescendant') ?? '')
      .toMatch(/-option-1$/);
    await userEvent.keyboard('{ArrowDown}');

    await expect.poll(() => input().hasAttribute('aria-activedescendant')).toBe(false);
    await expect.poll(() => document.activeElement).toBe(input());
  });

  it('does not mark the combobox expanded when there are no results', async () => {
    render(<ComboHarness groups={[]} />);

    await userEvent.click(input());
    await userEvent.keyboard('z');

    await expect.poll(() => screen.getByText('No results').textContent).toBe('No results');
    await expect.poll(() => screen.queryByRole('listbox')).toBeNull();
    await expect.poll(() => input().getAttribute('aria-expanded')).toBe('false');
  });
});
