import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import {
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
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

  it('points aria-controls at the listbox only while it is open', async () => {
    const user = userEvent.setup();
    render(
      <Select defaultValue="any">
        <SelectTrigger id="condition">
          <SelectValue placeholder="Condition" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).not.toHaveAttribute('aria-controls');
    trigger.focus();
    await user.keyboard('{Enter}');
    const listbox = await screen.findByRole('listbox');
    expect(listbox.id).not.toBe('');
    expect(trigger).toHaveAttribute('aria-controls', listbox.id);

    await user.keyboard('{Escape}');
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('makes the page outside the open list inert and restores it before focus returns', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <a href="/series">Series</a>
        <Select defaultValue="any">
          <SelectTrigger id="condition">
            <SelectValue placeholder="Condition" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="none">Not specified</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );

    const trigger = screen.getByRole('combobox');
    expect(container).not.toHaveAttribute('inert');
    trigger.focus();
    await user.keyboard('{Enter}');
    const listbox = await screen.findByRole('listbox');

    expect(container).toHaveAttribute('inert');
    expect(container).toHaveAttribute('aria-hidden', 'true');
    expect(container.contains(listbox)).toBe(false);

    await user.keyboard('{Escape}');

    expect(container).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    expect(container).toHaveAttribute('inert');
    await user.click(await screen.findByRole('option', { name: 'Not specified' }));

    expect(container).not.toHaveAttribute('inert');
    expect(trigger).toHaveTextContent('Not specified');
    expect(trigger).toHaveFocus();
  });
});

function CondSelect({ id, label }: { id: string; label: string }) {
  return (
    <Select defaultValue="a">
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">{`${label} A`}</SelectItem>
        <SelectItem value="b">{`${label} B`}</SelectItem>
      </SelectContent>
    </Select>
  );
}

const inertCount = () => document.querySelectorAll('[inert]').length;

describe('ui-web Select inert cleanup (CH-219 §3–§5)', () => {
  it('19-3: unmounting an open Select leaves no inert behind', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [shown, setShown] = React.useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>
            Hide
          </button>
          {shown ? <CondSelect id="s1" label="One" /> : null}
        </>
      );
    }
    const { container } = render(<Harness />);
    screen.getByRole('combobox').focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    expect(container).toHaveAttribute('inert');

    // The page is inert while open, so unmount the way a parent re-render would.
    fireEvent.click(screen.getByRole('button', { name: 'Hide', hidden: true }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(inertCount()).toBe(0);
  });

  it('19-3: a route change while open lets the new page Tab to its links', async () => {
    const user = userEvent.setup();
    let go: (to: string) => void = () => {};
    function Nav() {
      go = useNavigate();
      return null;
    }
    const { container } = render(
      <MemoryRouter initialEntries={['/series']}>
        <Nav />
        <Routes>
          <Route path="/series" element={<CondSelect id="s1" label="One" />} />
          <Route path="/calendar" element={<a href="/forum">Forum</a>} />
        </Routes>
      </MemoryRouter>,
    );
    screen.getByRole('combobox').focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    expect(container).toHaveAttribute('inert');

    React.act(() => go('/calendar'));
    expect(await screen.findByRole('link', { name: 'Forum' })).toBeInTheDocument();
    expect(inertCount()).toBe(0);
    document.body.focus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Forum' })).toHaveFocus();
  });

  it('19-2: clicking outside closes, clears inert, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <a href="/series">Series</a>
        <CondSelect id="s1" label="One" />
      </>,
    );
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    expect(container).toHaveAttribute('inert');

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(inertCount()).toBe(0);
    expect(trigger).toHaveFocus();
  });

  it('19-4: two Selects opened one after another leave no inert behind', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <CondSelect id="s1" label="One" />
        <CondSelect id="s2" label="Two" />
      </>,
    );
    const [one, two] = screen.getAllByRole('combobox');
    one!.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    expect(container).toHaveAttribute('inert');
    await user.keyboard('{Escape}');
    expect(one).toHaveFocus();

    two!.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('option', { name: 'Two A' });
    expect(container).toHaveAttribute('inert');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(two).toHaveTextContent('Two B');
    expect(two).toHaveFocus();
    expect(inertCount()).toBe(0);
  });

  it('19-4: keeps inert that was on the page before it opened', async () => {
    const user = userEvent.setup();
    const before = document.createElement('div');
    before.setAttribute('inert', '');
    before.innerHTML = '<a href="/x">Dialog link</a>';
    document.body.appendChild(before);
    try {
      const { container } = render(<CondSelect id="s1" label="One" />);
      const trigger = screen.getByRole('combobox');
      const baseline = inertCount();
      trigger.focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('listbox');
      expect(container).toHaveAttribute('inert');
      expect(inertCount()).toBeGreaterThan(baseline);
      await user.keyboard('{Escape}');

      expect(container).not.toHaveAttribute('inert');
      expect(before).toHaveAttribute('inert');
      expect(inertCount()).toBe(baseline);
      expect(trigger).toHaveFocus();
    } finally {
      before.remove();
    }
  });

  it('19-2: opening and closing twice leaves no inert behind', async () => {
    const user = userEvent.setup();
    const { container } = render(<CondSelect id="s1" label="One" />);
    const trigger = screen.getByRole('combobox');
    const baseline = inertCount();
    for (let i = 0; i < 2; i++) {
      trigger.focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('listbox');
      expect(container).toHaveAttribute('inert');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
      expect(container).not.toHaveAttribute('inert');
      expect(inertCount()).toBe(baseline);
      expect(trigger).toHaveFocus();
    }
  });

  it('19-4: a node that was inert before stays inert across two opens', async () => {
    const user = userEvent.setup();
    const before = document.createElement('div');
    before.setAttribute('inert', '');
    document.body.appendChild(before);
    try {
      render(<CondSelect id="s1" label="One" />);
      const trigger = screen.getByRole('combobox');
      for (let i = 0; i < 2; i++) {
        trigger.focus();
        await user.keyboard('{Enter}');
        await screen.findByRole('listbox');
        await user.keyboard('{Escape}');
        expect(before).toHaveAttribute('inert');
      }
    } finally {
      before.remove();
    }
  });

  it('19-7: inert another source adds while the list is open is kept on close', async () => {
    const user = userEvent.setup();
    const other = document.createElement('div');
    other.innerHTML = '<a href="/x">Other link</a>';
    document.body.appendChild(other);
    try {
      const { container } = render(<CondSelect id="s1" label="One" />);
      const trigger = screen.getByRole('combobox');
      trigger.focus();
      await user.keyboard('{Enter}');
      await screen.findByRole('listbox');
      expect(other).toHaveAttribute('inert');
      // e.g. a dialog opening behind the list marks the same node inert
      other.setAttribute('inert', '');
      await user.keyboard('{Escape}');

      expect(container).not.toHaveAttribute('inert');
      expect(other).toHaveAttribute('inert');
      expect(trigger).toHaveFocus();
    } finally {
      other.remove();
    }
  });

  it('19-7: A opens, B opens, A closes first — shared nodes stay inert until B closes', async () => {
    // Radix closes an open Select on any outside pointer/focus, so two lists cannot be
    // opened together by user events. Drive both with the controlled `open` prop instead.
    function Controlled({ label, open }: { label: string; open: boolean }) {
      return (
        <Select defaultValue="a" open={open} onOpenChange={() => {}}>
          <SelectTrigger aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">{`${label} A`}</SelectItem>
            <SelectItem value="b">{`${label} B`}</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    const outside = document.createElement('div');
    outside.innerHTML = '<a href="/x">Shared link</a>';
    document.body.appendChild(outside);
    try {
      const baseline = inertCount();
      const view = (a: boolean, b: boolean) => (
        <>
          <Controlled label="A" open={a} />
          <Controlled label="B" open={b} />
        </>
      );
      const { container, rerender } = render(view(true, false));
      await screen.findByRole('option', { name: 'A A' });
      expect(container).toHaveAttribute('inert');
      expect(outside).toHaveAttribute('inert');

      rerender(view(true, true));
      await screen.findByRole('option', { name: 'B A' });

      rerender(view(false, true));
      await waitFor(() => expect(screen.queryByRole('option', { name: 'A A' })).toBeNull());
      expect(screen.getByRole('option', { name: 'B A' })).toBeInTheDocument();
      expect(container).toHaveAttribute('inert');
      expect(outside).toHaveAttribute('inert');

      rerender(view(false, false));
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(container).not.toHaveAttribute('inert');
      expect(outside).not.toHaveAttribute('inert');
      expect(inertCount()).toBe(baseline);
    } finally {
      outside.remove();
    }
  });

  it('19-4: a Select inside a Dialog cleans up and keeps the Dialog usable', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Filters</DialogTitle>
          <DialogDescription>Pick one</DialogDescription>
          <CondSelect id="s1" label="One" />
        </DialogContent>
      </Dialog>,
    );
    const dialog = await screen.findByRole('dialog');
    const baseline = inertCount();
    const trigger = within(dialog).getByRole('combobox');
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    expect(inertCount()).toBeGreaterThan(baseline);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(inertCount()).toBe(baseline);
    expect(dialog.closest('[inert]')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('19-5: keeps live regions and their ancestors, inerts their siblings', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <main>
        <section data-testid="branch">
          <a href="/series/x">Card link</a>
        </section>
        <section data-testid="live-parent">
          <p data-testid="live" role="status" aria-live="polite">
            12 cards
          </p>
          <a href="/series/y">Sibling link</a>
        </section>
        <span data-testid="off" aria-live="off">
          0/200
        </span>
        <CondSelect id="s1" label="One" />
      </main>,
    );
    const baseline = inertCount();
    screen.getByRole('combobox').focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');

    const live = screen.getByTestId('live');
    expect(live.closest('[inert]')).toBeNull();
    expect(container.closest('[inert]')).toBeNull();
    expect(screen.getByTestId('live-parent')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('branch')).toHaveAttribute('inert');
    expect(screen.getByText('Card link').closest('[inert]')).not.toBeNull();
    expect(screen.getByText('Sibling link')).toHaveAttribute('inert');
    expect(screen.getByTestId('off')).toHaveAttribute('inert');
    // The trigger sits beside the portal's chain, so it is inert too while the list is open.
    expect(screen.getByRole('combobox', { hidden: true }).closest('[inert]')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(inertCount()).toBe(baseline);
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('19-5: a live region at the top of body stays out of inert', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <div aria-live="assertive" data-testid="toast" />
        <CondSelect id="s1" label="One" />
      </>,
    );
    screen.getByRole('combobox').focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    expect(screen.getByTestId('toast').closest('[inert]')).toBeNull();
    expect(container.closest('[inert]')).toBeNull();
    await user.keyboard('{Escape}');
    expect(inertCount()).toBe(0);
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

  it('scrolls the highlighted option into view when ArrowDown moves the highlight', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalElement = Element.prototype.scrollIntoView;
    const originalHtml = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Element.prototype.scrollIntoView = scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const items = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((name) => ({
      id: name.toLowerCase(),
      name,
    }));
    try {
      render(<ComboHarness groups={[{ key: 'cards', label: 'Cards', items }]} />);
      const input = screen.getByRole('combobox');
      await user.type(input, 'a');
      await screen.findByRole('listbox');
      scrollIntoView.mockClear();

      for (let step = 0; step < 6; step += 1) {
        await user.keyboard('{ArrowDown}');
      }

      const sixth = screen.getByRole('option', { name: 'Six' });
      const nearestCalls = scrollIntoView.mock.calls
        .map((args, index) => ({ args, instance: scrollIntoView.mock.instances[index] }))
        .filter((call) => call.args[0]?.block === 'nearest');
      expect(nearestCalls.length).toBeGreaterThan(0);
      expect(nearestCalls.at(-1)?.instance).toBe(sixth);
      expect(nearestCalls.at(-1)?.args[0]).toEqual({ block: 'nearest' });
    } finally {
      Element.prototype.scrollIntoView = originalElement;
      if (originalHtml) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalHtml);
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          writable: true,
          value: originalElement,
        });
      }
    }
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
