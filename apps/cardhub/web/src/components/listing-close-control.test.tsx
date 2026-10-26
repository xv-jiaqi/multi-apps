import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rootStore } from '../stores/root-store';
import { ListingCloseControl } from './listing-close-control';

const closeState = vi.hoisted(() => ({
  pending: false,
  fail: false,
  calls: new Array<{ id: string; reason?: string }>(),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    listings: {
      close: {
        useMutation: (options: { onError?: (error: { data?: { code?: string } }) => void }) => ({
          mutate: (input: { id: string; reason?: string }) => {
            closeState.calls.push(input);
            if (closeState.fail) {
              options.onError?.({ data: { code: 'INTERNAL_SERVER_ERROR' } });
            }
          },
          isPending: closeState.pending,
        }),
      },
    },
  },
}));

function CloseHarness({ showReason = false }: { showReason?: boolean }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  return (
    <ul>
      {['listing-a', 'listing-b'].map((id) => (
        <li key={id}>
          <div className="flex flex-wrap items-center justify-between">
            <span>meta-{id}</span>
            <ListingCloseControl
              listingId={id}
              showReason={showReason}
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
    closeState.fail = false;
    closeState.calls = [];
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

  it('omits the reason field unless an admin is closing someone else', async () => {
    const user = userEvent.setup();
    render(<CloseHarness />);
    await user.click(screen.getAllByRole('button', { name: '关闭这条意向' })[0]!);
    expect(screen.queryByLabelText('删除原因（选填，只有管理员能看到）')).not.toBeInTheDocument();
  });

  it('tabs reason, close, then cancel, and keeps the reason when close fails', async () => {
    closeState.fail = true;
    const user = userEvent.setup();
    render(<CloseHarness showReason />);

    await user.click(screen.getAllByRole('button', { name: '关闭这条意向' })[0]!);
    const reason = screen.getByLabelText('删除原因（选填，只有管理员能看到）');
    const close = screen.getByRole('button', { name: '关闭意向' });
    const cancel = screen.getByRole('button', { name: '取消' });
    await waitFor(() => expect(cancel).toHaveFocus());
    reason.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.type(reason, ' sold ');
    await user.click(close);
    expect(closeState.calls).toEqual([{ id: 'listing-a', reason: 'sold' }]);
    expect(reason).toHaveValue(' sold ');
    expect(screen.getByRole('alert')).toHaveTextContent('关闭失败，请重试');
    expect(
      screen.getByRole('group', { name: '关闭这条意向？关闭后不能重新开放。' }),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('删除原因（选填，只有管理员能看到）')).not.toBeInTheDocument();
    const firstRow = screen.getByText('meta-listing-a').parentElement;
    if (!firstRow) throw new Error('listing row is missing');
    await waitFor(() =>
      expect(within(firstRow).getByRole('button', { name: '关闭这条意向' })).toHaveFocus(),
    );
  });
});
