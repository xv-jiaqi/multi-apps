import '../pages/admin/test-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardPicker } from './card-picker';

const results = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    cards: {
      search: {
        useQuery: () => ({
          data: { query: '卡', results: results.items },
          isLoading: false,
          isFetching: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

describe('card picker parallel names', () => {
  it('adds the parallel name only when the card is still a parallel', async () => {
    const user = userEvent.setup();
    results.items = [
      {
        id: 'orphan',
        slug: 'qa-orphan',
        name: 'QA 孤儿卡',
        rarity: 'rare',
        imageUrl: null,
        seriesSlug: 'dawn',
        seriesTitle: '天穹黎明',
        parallelName: '金箔',
        isParallel: false,
      },
      {
        id: 'foil',
        slug: 'qa-foil',
        name: 'QA 金卡',
        rarity: 'rare',
        imageUrl: null,
        seriesSlug: 'dawn',
        seriesTitle: '天穹黎明',
        parallelName: '金箔',
        isParallel: true,
      },
    ];
    render(<CardPicker locale="zh-CN" value={null} onValueChange={() => undefined} />);
    await user.type(screen.getByRole('combobox'), '卡');
    const orphan = await screen.findByRole('option', { name: /QA 孤儿卡/ });
    const foil = screen.getByRole('option', { name: /QA 金卡 · 金箔/ });
    expect(orphan).not.toHaveTextContent('金箔');
    expect(foil).toHaveTextContent('QA 金卡 · 金箔');
    expect(screen.queryByRole('option', { name: /QA 孤儿卡 · 金箔/ })).not.toBeInTheDocument();
  });
});
