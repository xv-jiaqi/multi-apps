import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Combobox,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
}

if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}

if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

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
  mode = 'select',
  status = 'success',
  groups = [{ key: 'cards', label: 'Cards', items: [alpha, beta] }],
  onSelect = vi.fn(),
  onValueChange = vi.fn(),
  onRetry = vi.fn(),
  onEnterWithoutHighlight = vi.fn(),
  emptyQueryContent,
  hint,
  inputRef,
  initialValue = null,
  size = 'default',
}: {
  mode?: 'select' | 'navigate';
  status?: 'idle' | 'loading' | 'error' | 'success';
  groups?: Array<{ key: string; label?: string; items: Item[] }>;
  onSelect?: (item: Item) => void;
  onValueChange?: (item: Item | null) => void;
  onRetry?: () => void;
  onEnterWithoutHighlight?: (query: string) => void;
  emptyQueryContent?: React.ReactNode;
  hint?: React.ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
  initialValue?: Item | null;
  size?: 'default' | 'sm';
}) {
  const [query, setQuery] = React.useState('');
  const [value, setValue] = React.useState<Item | null>(initialValue);
  return (
    <Combobox
      mode={mode}
      size={size}
      value={value}
      onValueChange={(item) => {
        setValue(item);
        onValueChange(item);
      }}
      onSelect={onSelect}
      inputValue={query}
      onInputValueChange={setQuery}
      groups={groups}
      getKey={(item) => item.id}
      renderItem={(item) => <span>{item.name}</span>}
      getItemText={(item) => item.name}
      status={status}
      onRetry={onRetry}
      labels={labels}
      placeholder="Search cards"
      onEnterWithoutHighlight={onEnterWithoutHighlight}
      emptyQueryContent={emptyQueryContent}
      hint={hint}
      contentClassName="min-w-80"
      align="end"
      inputRef={inputRef}
    />
  );
}

describe('ui-web Select', () => {
  it('opens from the keyboard, selects an item, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Select defaultValue="any">
        <SelectTrigger id="condition">
          <SelectValue placeholder="Condition" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="none">Not specified</SelectItem>
            <SelectItem value="near_mint">Near mint</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(trigger).toHaveTextContent('Not specified');

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: 'Any' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(trigger).toHaveFocus();
  });
});

describe('ui-web Combobox', () => {
  it('keeps icon padding on the small size without the compact horizontal padding', () => {
    render(<ComboHarness size="sm" />);

    const input = screen.getByRole('combobox');
    expect(input).toHaveClass('pl-9');
    expect(input).toHaveClass('pr-9');
    expect(input).toHaveClass('h-8');
    expect(input).toHaveClass('text-sm');
    expect(input).not.toHaveClass('px-2.5');
  });

  it('exposes combobox/listbox ARIA and selects the highlighted item', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ComboHarness onValueChange={onValueChange} />);

    const input = screen.getByRole('combobox', { name: '' });
    await user.type(input, 'a');

    const listbox = await screen.findByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(within(listbox).getByRole('option', { name: 'Alpha' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');

    expect(onValueChange).toHaveBeenCalledWith(alpha);
    expect(input).toHaveValue('Alpha');
  });

  it('closes on first Escape, reopens after more typing, and clears on second Escape', async () => {
    const user = userEvent.setup();
    render(<ComboHarness />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'pika');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('pika');

    await user.type(input, 'chu');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('pikachu');

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
  });

  it('keeps select-mode value while editing and restores it on Escape', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ComboHarness initialValue={alpha} onValueChange={onValueChange} />);

    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('Alpha');

    await user.type(input, 'p');
    expect(onValueChange).not.toHaveBeenCalledWith(null);
    expect(input).toHaveValue('Alphap');

    await user.keyboard('{Escape}');
    expect(input).toHaveValue('Alpha');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('closes hint popovers on outside interaction', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ComboHarness hint={<span>Unsupported prefix</span>} />
        <button type="button">Outside</button>
      </div>,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'foo:bar');
    expect(await screen.findByRole('status')).toHaveTextContent('Unsupported prefix');

    await user.click(screen.getByRole('button', { name: 'Outside' }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('clears highlight with ArrowUp at the top, leaves Home/End to the input, and clears on mouse leave', async () => {
    const user = userEvent.setup();
    render(<ComboHarness />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'a');
    const listbox = await screen.findByRole('listbox');

    await user.keyboard('{ArrowDown}');
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();

    await user.keyboard('{Home}{End}');
    expect(input).toHaveAttribute('aria-activedescendant', activeId);

    await user.keyboard('{ArrowUp}');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant');
    fireEvent.mouseLeave(listbox);
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(input).toHaveFocus();
  });

  it('does not reopen an empty dismissed popover with ArrowDown', async () => {
    const user = userEvent.setup();
    render(<ComboHarness groups={[]} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'z');
    expect(await screen.findByRole('status')).toHaveTextContent('No results');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps option ids unique when item keys repeat across groups', async () => {
    const user = userEvent.setup();
    render(
      <ComboHarness
        groups={[
          { key: 'cards', label: 'Cards', items: [alpha] },
          { key: 'series', label: 'Series', items: [alpha] },
        ]}
      />,
    );

    await user.type(screen.getByRole('combobox'), 'a');

    const options = await screen.findAllByRole('option', { name: 'Alpha' });
    expect(options).toHaveLength(2);
    expect(options[0]!.id).not.toBe(options[1]!.id);
  });

  it('does not select an item on Tab', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <>
        <ComboHarness onValueChange={onValueChange} />
        <button type="button">Next</button>
      </>,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'a');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Tab}');

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps previous results visible while loading', async () => {
    function LoadingHarness() {
      const [status, setStatus] = React.useState<'success' | 'loading'>('success');
      return (
        <>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setStatus('loading')}
          >
            Load
          </button>
          <ComboHarness
            status={status}
            groups={status === 'loading' ? [] : [{ key: 'cards', items: [alpha] }]}
          />
        </>
      );
    }

    const user = userEvent.setup();
    render(<LoadingHarness />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'a');
    expect(await screen.findByRole('option', { name: 'Alpha' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load' }));
    fireEvent.focus(input);

    expect(await screen.findByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('retries on Enter when showing the error state', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ComboHarness status="error" groups={[]} onRetry={onRetry} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'a');
    expect(await screen.findByRole('status')).toHaveTextContent('Search failed');
    await user.keyboard('{Enter}');

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('clears select-mode value with the clear button', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<ComboHarness onValueChange={onValueChange} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'a');
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onValueChange).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('calls navigate fallback on Enter without a highlighted item', async () => {
    const user = userEvent.setup();
    const onEnterWithoutHighlight = vi.fn();
    const onSelect = vi.fn();
    render(
      <ComboHarness
        mode="navigate"
        onSelect={onSelect}
        onEnterWithoutHighlight={onEnterWithoutHighlight}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'alpha');
    await user.keyboard('{Enter}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(onEnterWithoutHighlight).toHaveBeenCalledWith('alpha');
  });

  it('supports empty-query content, hints, content classes, and external input refs', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<HTMLInputElement>();
    const { rerender } = render(
      <ComboHarness emptyQueryContent={<span>Try r:legendary</span>} inputRef={ref} />,
    );

    ref.current?.focus();
    expect(await screen.findByRole('status')).toHaveTextContent('Try r:legendary');
    expect(screen.getByRole('status').parentElement).toHaveClass('min-w-80');

    rerender(<ComboHarness hint={<span>Unsupported prefix</span>} inputRef={ref} />);
    await user.type(screen.getByRole('combobox'), 'usd<1');

    expect(await screen.findByRole('status')).toHaveTextContent('Unsupported prefix');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('ui-web SegmentedControl', () => {
  it('uses native radio selection and exposes the selected styling class', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = React.useState('all');
      return (
        <SegmentedControl
          legend="Listing type"
          name="kind"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'all', label: 'All' },
            { value: 'sell', label: 'Sell' },
            { value: 'buy', label: 'Buy' },
          ]}
        />
      );
    }

    render(<Harness />);

    const all = screen.getByRole('radio', { name: 'All' });
    const sell = screen.getByRole('radio', { name: 'Sell' });

    expect(all).toBeChecked();
    expect(all.closest('label')).toHaveClass('has-[:checked]:bg-brand-600');

    all.focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(sell).toBeChecked());
  });
});
