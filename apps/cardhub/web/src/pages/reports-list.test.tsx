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
  isFetching: boolean;
  error: { message: string } | null;
} = {
  items: [],
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null,
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    search: {
      global: {
        useQuery: () => ({
          data: undefined,
          isFetching: false,
          isError: false,
          isSuccess: false,
          refetch: vi.fn(),
        }),
      },
    },
    reports: {
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: queryState.items, nextCursor: null }] },
          isLoading: queryState.isLoading,
          isError: queryState.isError,
          isFetching: queryState.isFetching,
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
          onError?: (error: { data?: { code?: string } }, variables: { action: string }) => void;
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
  queryState.isFetching = false;
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

  it('uses close copy for listing reports', async () => {
    const user = userEvent.setup();
    queryState.items = [
      {
        ...reportFixture,
        targetType: 'LISTING',
        target: {
          cardSlug: 'forge-titan',
          cardName: 'Forge Titan',
          sellerUsername: 'seller',
          status: 'OPEN',
        },
      },
    ];

    renderPage();

    expect(screen.getByRole('button', { name: '关闭意向并处理' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除内容并处理' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forge Titan' })).toHaveAttribute(
      'href',
      '/cards/forge-titan',
    );
    expect(screen.getByText('开放中')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关闭意向并处理' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('这条交易意向将被关闭');
  });

  it('links the remove confirmation dialog to its warning copy', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];

    renderPage();

    await user.click(screen.getByRole('button', { name: '删除内容并处理' }));
    const dialog = screen.getByRole('alertdialog');
    const descriptionId = dialog.getAttribute('aria-describedby');

    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent('删除后无法恢复');
  });

  it('keeps the confirmation open when Esc is pressed while submitting', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];

    renderPage();

    await user.click(screen.getByRole('button', { name: '删除内容并处理' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled();
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

  it('moves focus to repeated success messages with identical text', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];
    mutateResolve.mockImplementation((_input, { onSuccess }) => {
      void onSuccess?.(null, _input);
    });

    renderPage();

    await user.click(screen.getByRole('button', { name: '标记已处理' }));
    const firstStatus = await screen.findByRole('status');
    expect(firstStatus).toHaveFocus();
    firstStatus.blur();

    await user.click(screen.getByRole('button', { name: '标记已处理' }));

    expect(await screen.findByRole('status')).toHaveFocus();
  });

  it('shows forbidden resolve failures and keeps the resolution note', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];
    mutateResolve.mockImplementation((_input, { onError }) => {
      onError?.({ data: { code: 'FORBIDDEN' } }, _input);
    });

    renderPage();

    await user.type(screen.getByLabelText('处理说明（选填）'), '稍后人工复核');
    await user.click(screen.getByRole('button', { name: '标记已处理' }));

    expect(screen.getByRole('alert')).toHaveTextContent('你没有权限处理这条举报');
    expect(screen.getByLabelText('处理说明（选填）')).toHaveValue('稍后人工复核');
    expect(screen.getByRole('button', { name: '标记已处理' })).toHaveFocus();
  });

  it('shows generic resolve failures and keeps the resolution note', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];
    mutateResolve.mockImplementation((_input, { onError }) => {
      onError?.({ data: { code: 'INTERNAL_SERVER_ERROR' } }, _input);
    });

    renderPage();

    await user.type(screen.getByLabelText('处理说明（选填）'), '违规截图已保存');
    await user.click(screen.getByRole('button', { name: '标记已处理' }));

    expect(screen.getByRole('alert')).toHaveTextContent('处理失败，请重试');
    expect(screen.getByLabelText('处理说明（选填）')).toHaveValue('违规截图已保存');
  });

  it('renders a processing state while a resolve request is pending', async () => {
    const user = userEvent.setup();
    queryState.items = [reportFixture];

    renderPage();

    await user.click(screen.getByRole('button', { name: '标记已处理' }));

    expect(
      screen.getAllByRole('listitem').find((item) => item.getAttribute('aria-busy')),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled();
    expect(screen.getByLabelText('处理说明（选填）')).toHaveAttribute('readonly');
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

  it('disables the list retry button while refetching after a load error', async () => {
    queryState.isError = true;
    queryState.isFetching = true;
    queryState.error = { message: 'boom' };

    renderPage();

    expect(screen.getByRole('button', { name: '加载中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '加载中…' })).toHaveAttribute('aria-busy', 'true');
  });

  it('gives filter pills a ring offset and lets report meta wrap to its own row', () => {
    queryState.items = [reportFixture];

    renderPage();

    expect(screen.getByRole('button', { name: '全部' })).toHaveClass('focus-visible:ring-offset-2');
    const meta = screen.getByText('@bob').parentElement;
    expect(meta).toHaveClass('w-full');
    expect(meta).toHaveClass('sm:w-auto');
    expect(meta).toHaveClass('sm:text-right');
    expect(screen.getByText('spam report').parentElement).toHaveClass('min-w-0', 'flex-1');
  });

  it('allows long unbroken resolution notes to wrap inside the details grid', () => {
    const longResolution = 'R'.repeat(120);
    queryState.items = [
      {
        ...reportFixture,
        status: 'RESOLVED',
        resolvedAt: '2026-05-02T00:00:00.000Z',
        resolver: { id: 'admin-id', username: 'admin' },
        resolution: longResolution,
      },
    ];

    renderPage();

    const resolution = screen.getByText(longResolution);
    expect(resolution).toHaveClass('min-w-0');
    expect(resolution).toHaveClass('[overflow-wrap:anywhere]');
    expect(screen.getByText('处理说明')).toHaveClass('whitespace-nowrap');
  });
});
