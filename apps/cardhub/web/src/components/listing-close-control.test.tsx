import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rootStore } from '../stores/root-store';
import { ListingCloseControl } from './listing-close-control';

const closeState = vi.hoisted(() => ({ pending: false }));

vi.mock('../lib/trpc', () => ({
  trpc: {
    listings: {
      close: {
        useMutation: () => ({ mutate: vi.fn(), isPending: closeState.pending }),
      },
    },
  },
}));

function CloseHarness() {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  return (
    <ul>
      {['listing-a', 'listing-b'].map((id) => (
        <li key={id}>
          <div className="flex flex-wrap items-center justify-between">
            <span>meta-{id}</span>
            <ListingCloseControl
              listingId={id}
              confirming={confirmingId === id}
              onConfirmingChange={(open) =>
                setConfirmingId((current) => (open ? id : current === id ? null : current))
              }
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

describe('ListingCloseControl', () => {
  beforeEach(() => {
    closeState.pending = false;
    rootStore.locale.setLocale('zh-CN');
  });

  it('keeps only one confirm bar open, under the row, and hides that close button', async () => {
    const user = userEvent.setup();
    render(<CloseHarness />);

    const triggers = screen.getAllByRole('button', { name: '关闭这条意向' });
    await user.click(triggers[0]!);

    const group = screen.getByRole('group', { name: '关闭这条意向？关闭后不能重新开放。' });
    const firstMeta = screen.getByText('meta-listing-a');
    const firstRow = firstMeta.parentElement;
    if (!firstRow) throw new Error('listing row is missing');
    expect(
      within(firstRow).queryByRole('button', { name: '关闭这条意向' }),
    ).not.toBeInTheDocument();
    expect(firstRow.contains(group)).toBe(true);
    expect(firstMeta.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole('button', { name: '关闭这条意向' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关闭这条意向' }));
    expect(
      screen.getAllByRole('group', { name: '关闭这条意向？关闭后不能重新开放。' }),
    ).toHaveLength(1);
    expect(
      within(screen.getByText('meta-listing-b').parentElement!).getByRole('group'),
    ).toBeInTheDocument();
    expect(within(firstRow).getByRole('button', { name: '关闭这条意向' })).toBeInTheDocument();
  });

  it('marks the confirm bar busy while the close is pending', async () => {
    closeState.pending = true;
    const user = userEvent.setup();
    render(<CloseHarness />);

    await user.click(screen.getAllByRole('button', { name: '关闭这条意向' })[0]!);
    expect(
      screen.getByRole('group', { name: '关闭这条意向？关闭后不能重新开放。' }),
    ).toHaveAttribute('aria-busy', 'true');
  });
});
