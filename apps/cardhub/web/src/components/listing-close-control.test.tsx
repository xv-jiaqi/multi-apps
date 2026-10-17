import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rootStore } from '../stores/root-store';
import { ListingCloseControl } from './listing-close-control';

vi.mock('../lib/trpc', () => ({
  trpc: {
    listings: {
      close: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

describe('ListingCloseControl', () => {
  beforeEach(() => {
    rootStore.locale.setLocale('zh-CN');
  });

  it('keeps only one confirm bar open', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ListingCloseControl listingId="listing-a" />
        <ListingCloseControl listingId="listing-b" />
      </>,
    );

    const triggers = screen.getAllByRole('button', { name: '关闭这条意向' });
    await user.click(triggers[0]!);
    expect(
      screen.getAllByRole('group', { name: '关闭这条意向？关闭后不能重新开放。' }),
    ).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '关闭这条意向' }));
    expect(
      screen.getAllByRole('group', { name: '关闭这条意向？关闭后不能重新开放。' }),
    ).toHaveLength(1);
  });
});
