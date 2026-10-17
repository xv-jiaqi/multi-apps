import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

const invalidateReports = vi.fn();
const mutateResolve = vi.fn();

type ReportFixture = {
  id: string;
  targetId: string;
  targetType: 'LISTING' | 'TOPIC' | 'REPLY' | 'COMMENT';
  target: Record<string, unknown> | null;
  reason: string;
  status: 'PENDING' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string | null;
  resolver: { id: string; username: string } | null;
  resolution: string | null;
  reporter: { id: string; username: string };
};

const reportFixture: ReportFixture = {
  id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
  targetId: 'target-1',
  targetType: 'COMMENT',
  target: {
    cardSlug: 'aurora-knight',
    cardName: 'Aurora Knight',
    authorUsername: 'alice',
    excerpt: 'bad comment',
  },
  reason: 'spam report',
  status: 'PENDING',
  createdAt: '2026-05-01T00:00:00.000Z',
  resolvedAt: null,
  resolver: null,
  resolution: null,
  reporter: { id: 'u1', username: 'bob' },
};

const queryState: {
  items: ReportFixture[];
  isLoading: boolean;
  isError: boolean;
  error: { message: string } | null;
} = {
  items: [],
  isLoading: false,
  isError: false,
  error: null,
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    reports: {
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: queryState.items, nextCursor: null }] },
          isLoading: queryState.isLoading,
          isError: queryState.isError,
          error: queryState.error,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          refetch: vi.fn(),
        }),
      },
      resolve: {
        useMutation: ({
          onSuccess,
          onError,
        }: {
          onSuccess?: (_data: unknown, variables: unknown) => void | Promise<void>;
          onError?: (error: { data?: { code?: string } }) => void;
        }) => ({
          mutate: (input: unknown) => mutateResolve(input, { onSuccess, onError }),
        }),
      },
    },
    useUtils: () => ({
      reports: { list: { invalidate: invalidateReports } },
    }),
  },
}));

import { ReportsListPage } from './reports-list';

function renderPage() {
  return render(
    <MemoryRouter>
      <ReportsListPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.session.signIn('token', { id: 'admin-id', username: 'admin', role: 'admin' });
  invalidateReports.mockReset();
  mutateResolve.mockReset();
  queryState.items = [];
  queryState.isLoading = false;
  queryState.isError = false;
  queryState.error = null;
});

describe('ReportsListPage resolution controls', () => {
  it('renders pending resolve controls and opens inline remove confirmation', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];

    renderPage();

    expect(screen.getByLabelText('处理说明（选填）')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除内容并处理' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('删除后无法恢复');
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
  });

  it('returns focus to the remove trigger after canceling inline confirmation', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];

    renderPage();

    await user.click(screen.getByRole('button', { name: '删除内容并处理' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.getByRole('button', { name: '删除内容并处理' })).toHaveFocus();
  });

  it('returns focus to the remove trigger after dismissing inline confirmation with Esc', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];

    renderPage();

    await user.click(screen.getByRole('button', { name: '删除内容并处理' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: '删除内容并处理' })).toHaveFocus();
  });

  it('hides remove action when the reported content no longer exists', () => {
    queryState.items = [{ ...reportFixture, target: null }];

    renderPage();

    expect(screen.getByText('对应内容已不存在，保留此举报记录供审计参考')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标记已处理' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除内容并处理' })).not.toBeInTheDocument();
  });

  it('submits a trimmed optional note when marking resolved', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];
    mutateResolve.mockImplementation((_input, { onSuccess }) => {
      void onSuccess?.(null, _input);
    });

    renderPage();

    await user.type(screen.getByLabelText('处理说明（选填）'), '  已核实违规  ');
    await user.click(screen.getByRole('button', { name: '标记已处理' }));

    expect(mutateResolve.mock.calls[0]?.[0]).toEqual({
      id: reportFixture.id,
      action: 'MARK_RESOLVED',
      resolution: '已核实违规',
    });
    expect(invalidateReports).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('已标记为已处理');
  });

  it('renders resolved metadata as read-only details', () => {
    queryState.items = [
      {
        ...reportFixture,
        status: 'RESOLVED',
        resolvedAt: '2026-05-02T00:00:00.000Z',
        resolver: { id: 'admin-id', username: 'admin' },
        resolution: 'handled',
      },
    ];

    renderPage();

    expect(screen.getByText('处理人')).toBeInTheDocument();
    expect(screen.getAllByText('@admin').length).toBeGreaterThan(0);
    expect(screen.getByText('handled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '标记已处理' })).not.toBeInTheDocument();
  });
});
