import { APP_ERROR_CODES } from '@repo/shared';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';

const utilsInvalidate = vi.fn();
const listRepliesFetch = vi.fn();
const mutateMock = vi.fn();
const deleteMutateMock = vi.fn();
const refetchMock = vi.fn();

// useState-like holder so different tests can swap the responses returned by
// the mocked tRPC hooks without restructuring the mock itself.
const queryState: {
  data:
    | Array<{
        id: string;
        content: string;
        createdAt: string;
        user: { id: string; username: string };
        replyCount?: number;
        repliesNextCursor?: string | null;
        replies?: Array<{
          id: string;
          content: string;
          createdAt: string;
          user: { id: string; username: string };
        }>;
      }>
    | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: { message: string } | null;
  refetch: () => void;
} = {
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: refetchMock,
};
const mutationState: { isPending: boolean } = { isPending: false };
const deleteMutationState: { isPending: boolean; variables: { id: string } | undefined } = {
  isPending: false,
  variables: undefined,
};

vi.mock('../lib/trpc', () => {
  return {
    clearActiveQueryClient: vi.fn(),
    trpc: {
      comments: {
        listForCard: {
          useQuery: () => queryState,
        },
        listForSeries: {
          useQuery: () => queryState,
        },
        create: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: () => void;
            onError?: (e: { message: string }) => void;
          }) => ({
            mutate: (input: unknown) => mutateMock(input, { onSuccess, onError }),
            isPending: mutationState.isPending,
          }),
        },
        createForSeries: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: () => void;
            onError?: (e: { message: string }) => void;
          }) => ({
            mutate: (input: unknown) => mutateMock(input, { onSuccess, onError }),
            isPending: mutationState.isPending,
          }),
        },
        delete: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: () => void;
            onError?: (
              e: { message: string; data?: { code?: string } },
              variables: { id: string },
            ) => void;
          }) => ({
            mutate: (input: { id: string }) => deleteMutateMock(input, { onSuccess, onError }),
            isPending: deleteMutationState.isPending,
            variables: deleteMutationState.variables,
          }),
        },
      },
      reports: {
        create: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
          }),
        },
      },
      useUtils: () => ({
        comments: {
          listForCard: { invalidate: utilsInvalidate },
          listForSeries: { invalidate: utilsInvalidate },
          listReplies: { fetch: listRepliesFetch },
        },
      }),
    },
  };
});

import { CommentSection } from './comment-section';

function LocationProbe() {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname}|{JSON.stringify(location.state)}
    </p>
  );
}

function renderShell() {
  return render(
    <MemoryRouter>
      <CommentSection target={{ kind: 'card', slug: 'aurora-knight' }} />
    </MemoryRouter>,
  );
}

function renderSeriesShell() {
  return render(
    <MemoryRouter>
      <CommentSection target={{ kind: 'series', slug: 'sky-dawn' }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  utilsInvalidate.mockClear();
  listRepliesFetch.mockReset();
  mutateMock.mockClear();
  deleteMutateMock.mockClear();
  refetchMock.mockClear();
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signOut();
  queryState.data = [];
  queryState.isLoading = false;
  queryState.isFetching = false;
  queryState.isError = false;
  queryState.error = null;
  mutationState.isPending = false;
  deleteMutationState.isPending = false;
  deleteMutationState.variables = undefined;
});

describe('CommentSection (unauthenticated)', () => {
  it('renders three skeleton rows and aria-busy while comments load', async () => {
    queryState.isLoading = true;
    queryState.data = undefined;
    const { container } = renderShell();

    const section = container.querySelector('[aria-busy="true"]');
    expect(section).not.toBeNull();
    const list = section?.querySelector('ul');
    expect(list).toHaveAttribute('aria-hidden', 'true');
    const rows = list ? Array.from(list.querySelectorAll(':scope > li')) : [];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.querySelector('.rounded-full')).toBeNull();
      expect(row).not.toHaveClass('border-dashed');
      const bars = row.querySelectorAll('.animate-pulse.rounded.bg-neutral-200');
      expect(bars).toHaveLength(2);
      expect(bars[0]).toHaveClass('h-3', 'w-24', 'motion-reduce:animate-none');
      expect(bars[0]).not.toHaveClass('h-6');
      expect(bars[0]?.parentElement).toHaveClass('flex', 'h-6', 'items-center');
      expect(bars[1]).toHaveClass('h-4', 'w-full', 'motion-reduce:animate-none');
      expect(bars[1]).not.toHaveClass('h-5');
      expect(bars[1]?.parentElement).toHaveClass('mt-2', 'flex', 'h-5', 'items-center');
    }
    expect(screen.queryByText('还没有评论，来抢沙发吧')).not.toBeInTheDocument();
    const loading = screen.getByText('加载中');
    expect(loading).toHaveClass('sr-only');
    expect(list?.contains(loading)).toBe(false);

    act(() => {
      rootStore.locale.setLocale('en-US');
    });
    await waitFor(() => {
      expect(screen.getByText('Loading')).toHaveClass('sr-only');
    });
  });

  it('renders the sign-in prompt and no form', () => {
    renderShell();
    expect(screen.getByRole('link', { name: /登录后即可发表评论/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /发布评论/ })).not.toBeInTheDocument();
  });

  it.each([
    ['card', () => renderShell()],
    ['series', () => renderSeriesShell()],
  ] as const)(
    'shows a retryable alert when %s comments fail to load',
    async (_kind, renderTarget) => {
      const user = userEvent.setup();
      queryState.isError = true;
      queryState.error = { message: 'Internal server error (QA mock)' };
      renderTarget();

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('评论加载失败');
      expect(alert).not.toHaveTextContent('Internal server error');
      expect(alert).not.toHaveTextContent('QA mock');
      expect(alert).toHaveClass(
        'rounded-lg',
        'border-red-200',
        'bg-red-50',
        'p-6',
        'text-sm',
        'text-red-700',
      );
      expect(alert.querySelector('h1')).toBeNull();
      expect(alert.querySelector('p')).toHaveClass('font-medium');
      const retry = screen.getByRole('button', { name: '重试' });
      expect(retry).toHaveClass('mt-3', 'min-h-6', 'border-red-300', 'bg-white', 'text-red-700');
      expect(retry).not.toHaveClass('text-brand-600');
      expect(retry.className).not.toMatch(/ring-offset/);
      expect(screen.getByRole('link', { name: '登录后即可发表评论' })).toBeInTheDocument();

      await user.click(retry);
      expect(refetchMock).toHaveBeenCalledTimes(1);

      act(() => {
        rootStore.locale.setLocale('en-US');
      });
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load comments");
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      });
      expect(screen.getByRole('alert')).not.toHaveTextContent('QA mock');
    },
  );

  it('keeps the comment form above the load-failure box when signed in', async () => {
    rootStore.session.signIn('jwt.token', { id: 'u1', username: 'alice' });
    queryState.isError = true;
    queryState.error = { message: 'QA-INJECTED-xyz' };
    renderShell();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('评论加载失败');
    expect(alert).not.toHaveTextContent('QA-INJECTED-xyz');
    const form = screen.getByRole('button', { name: '发布评论' }).closest('form');
    expect(form).not.toBeNull();
    expect(screen.getByLabelText('撰写评论')).toBeInTheDocument();
    expect(form!.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no alert while comments load or after they succeed', () => {
    queryState.isLoading = true;
    queryState.data = undefined;
    const loading = renderShell();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    loading.unmount();

    queryState.isLoading = false;
    queryState.data = [
      {
        id: 'cm-1',
        content: 'great card',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    renderShell();
    expect(screen.getByText('great card')).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still surfaces existing comments for anonymous viewers', () => {
    queryState.data = [
      {
        id: 'cm-1',
        content: 'great card',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    renderShell();
    expect(screen.getByText('great card')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
  });
});

describe('CommentSection (authenticated)', () => {
  beforeEach(() => {
    rootStore.session.signIn('jwt.token', { id: 'u1', username: 'alice' });
  });

  it('shows the textarea + post button when signed in', () => {
    renderShell();
    expect(screen.getByLabelText(/撰写评论/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /发布评论/ })).toBeDisabled();
  });

  it('enables the button only when the textarea has non-whitespace content', async () => {
    const user = userEvent.setup();
    renderShell();
    const textarea = screen.getByLabelText(/撰写评论/);
    await user.type(textarea, '  ');
    expect(screen.getByRole('button', { name: /发布评论/ })).toBeDisabled();
    await user.type(textarea, 'a great card');
    expect(screen.getByRole('button', { name: /发布评论/ })).toBeEnabled();
  });

  it('calls the create mutation with the validated payload on submit', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.type(screen.getByLabelText(/撰写评论/), 'wow');
    await user.click(screen.getByRole('button', { name: /发布评论/ }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      cardSlug: 'aurora-knight',
      content: 'wow',
    });
  });

  it('calls the series create mutation with a series payload', async () => {
    const user = userEvent.setup();
    renderSeriesShell();
    await user.type(screen.getByLabelText(/撰写评论/), 'great series');
    await user.click(screen.getByRole('button', { name: /发布评论/ }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      seriesSlug: 'sky-dawn',
      content: 'great series',
    });
  });

  it('shows delete for authors and admins but hides it from other users', () => {
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];

    const { unmount } = renderShell();
    expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).toBeInTheDocument();
    unmount();

    rootStore.session.signIn('jwt.token', { id: 'u2', username: 'bob', role: 'admin' });
    const adminRender = renderShell();
    expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).toBeInTheDocument();
    adminRender.unmount();

    rootStore.session.signIn('jwt.token', { id: 'u3', username: 'charlie' });
    renderShell();
    expect(screen.queryByRole('button', { name: '删除 @alice 的评论' })).not.toBeInTheDocument();
  });

  it('uses inline confirmation and returns focus to delete on cancel', async () => {
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    renderShell();

    const deleteButton = screen.getByRole('button', { name: '删除 @alice 的评论' });
    await user.click(deleteButton);
    expect(screen.getByText('删除这条评论？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText('删除这条评论？')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).toHaveFocus(),
    );
  });

  it('collapses the delete confirmation on Esc and returns focus to delete', async () => {
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    renderShell();

    await user.click(screen.getByRole('button', { name: '删除 @alice 的评论' }));
    expect(screen.getByText('删除这条评论？')).toBeInTheDocument();
    expect(screen.queryByLabelText('删除原因（选填，只有管理员能看到）')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.queryByText('删除这条评论？')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).toHaveFocus(),
    );
  });

  it('shows an alert when comment deletion is forbidden', async () => {
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    deleteMutateMock.mockImplementationOnce(
      (
        input: { id: string },
        callbacks: {
          onError: (
            error: { message: string; data?: { code?: string } },
            variables: { id: string },
          ) => void;
        },
      ) => {
        callbacks.onError(
          {
            message: 'Forbidden',
            data: { code: 'FORBIDDEN' },
          },
          input,
        );
      },
    );
    renderShell();

    await user.click(screen.getByRole('button', { name: '删除 @alice 的评论' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(screen.getByRole('alert')).toHaveTextContent('你没有权限删除这条评论');
    expect(screen.getByRole('alert')).toHaveClass('bg-red-50');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).toHaveFocus(),
    );
  });

  it('asks an admin for a reason, tabs reason then delete then cancel, and keeps it on failure', async () => {
    rootStore.session.signIn('jwt.token', { id: 'u2', username: 'bob', role: 'admin' });
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    deleteMutateMock.mockImplementation((input, callbacks) => {
      callbacks.onError?.({ message: 'nope', data: { code: 'INTERNAL_SERVER_ERROR' } }, input);
    });
    renderShell();

    const trigger = screen.getByRole('button', { name: '删除 @alice 的评论' });
    await user.click(trigger);
    const reason = screen.getByLabelText('删除原因（选填，只有管理员能看到）');
    const remove = screen.getByRole('button', { name: '删除' });
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus();
    expect(reason.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(remove.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('0/500')).toBeInTheDocument();

    reason.focus();
    await user.tab();
    expect(remove).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.type(reason, '  spam  ');
    expect(screen.getByText('8/500')).toBeInTheDocument();
    await user.click(remove);
    expect(deleteMutateMock).toHaveBeenCalledWith(
      { id: 'cm-1', reason: 'spam' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(reason).toHaveValue('  spam  ');
    expect(reason).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('删除失败，请重试');
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('删除原因（选填，只有管理员能看到）')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).toHaveFocus(),
    );

    await user.click(screen.getByRole('button', { name: '删除 @alice 的评论' }));
    expect(screen.getByLabelText('删除原因（选填，只有管理员能看到）')).toHaveValue('');
  });

  it('shows a visible success status and focuses it after deleting a comment', async () => {
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    deleteMutateMock.mockImplementationOnce((_input, callbacks) => {
      callbacks.onSuccess?.();
    });
    renderShell();

    await user.click(screen.getByRole('button', { name: '删除 @alice 的评论' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('评论已删除');
    expect(status).toHaveClass('bg-emerald-50');
    expect(status).toHaveFocus();
  });

  it('uses a wrapped confirmation row and prevents disabled delete underline while deleting', async () => {
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'L'.repeat(80),
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    deleteMutationState.isPending = true;
    deleteMutationState.variables = { id: 'cm-1' };
    renderShell();

    await user.click(screen.getByRole('button', { name: '删除 @alice 的评论' }));

    expect(screen.getByRole('group', { name: '删除这条评论？' })).toHaveClass('bg-red-50');
    expect(screen.getByText('L'.repeat(80))).toHaveClass('wrap-anywhere');
    expect(screen.getByRole('button', { name: '删除中…' })).toHaveClass('disabled:no-underline');
  });

  it('shows a visible status message after successful deletion', async () => {
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    deleteMutateMock.mockImplementationOnce(
      (_input: { id: string }, callbacks: { onSuccess: () => void }) => {
        callbacks.onSuccess();
      },
    );
    renderShell();

    await user.click(screen.getByRole('button', { name: '删除 @alice 的评论' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(screen.getByRole('status')).toHaveTextContent('评论已删除');
    expect(screen.getByRole('status')).toHaveClass('bg-emerald-50');
  });

  it.each([
    ['card', () => renderShell()],
    ['series', () => renderSeriesShell()],
  ] as const)('treats NOT_FOUND as a successful %s comment delete', async (_kind, renderTarget) => {
    const user = userEvent.setup();
    queryState.data = [
      {
        id: 'cm-1',
        content: 'own comment',
        createdAt: '2026-05-01T00:00:00Z',
        user: { id: 'u1', username: 'alice' },
      },
    ];
    deleteMutateMock.mockImplementationOnce(
      (
        input: { id: string },
        callbacks: {
          onError: (
            error: { message: string; data?: { code?: string } },
            variables: { id: string },
          ) => void;
        },
      ) => {
        callbacks.onError({ message: '评论不存在', data: { code: 'NOT_FOUND' } }, input);
      },
    );
    renderTarget();

    await user.click(screen.getByRole('button', { name: '删除 @alice 的评论' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('评论已删除');
    expect(status).toHaveClass('bg-emerald-50');
    expect(status).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows localized copy when comment creation is rate limited', async () => {
    const user = userEvent.setup();
    mutateMock.mockImplementationOnce(
      (
        _input: unknown,
        callbacks: {
          onError: (error: { message: string; data?: { code?: string; appCode?: string } }) => void;
        },
      ) => {
        callbacks.onError({
          message: 'Too many requests',
          data: {
            code: 'TOO_MANY_REQUESTS',
            appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS,
          },
        });
      },
    );
    renderShell();

    await user.type(screen.getByLabelText(/撰写评论/), 'wow');
    await user.click(screen.getByRole('button', { name: /发布评论/ }));

    expect(screen.getByRole('alert')).toHaveTextContent('评论太频繁，请稍后再试');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Too many requests');
    expect(screen.getByLabelText(/撰写评论/)).toHaveValue('wow');
  });

  it.each([
    {
      name: 'server 500',
      message: 'RAW_SERVER_Prisma_boom INTERNAL_SERVER_ERROR',
      appCode: 'INTERNAL_SERVER_ERROR',
      code: 'INTERNAL_SERVER_ERROR',
      shown: '出了点问题，请稍后再试',
    },
    {
      name: 'zod validation',
      message: '评论不能为空',
      appCode: 'VALIDATION',
      code: 'BAD_REQUEST',
      shown: '填写的内容不符合要求，请修改后再试',
    },
  ])(
    'shows Chinese copy for a comment $name and hides the raw payload',
    async ({ message, appCode, code, shown }) => {
      const user = userEvent.setup();
      mutateMock.mockImplementationOnce(
        (
          _input: unknown,
          callbacks: {
            onError: (error: {
              message: string;
              data?: { code?: string; appCode?: string };
            }) => void;
          },
        ) => {
          callbacks.onError({ message, data: { code, appCode } });
        },
      );
      renderShell();

      await user.type(screen.getByLabelText(/撰写评论/), 'wow');
      await user.click(screen.getByRole('button', { name: /发布评论/ }));

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(shown);
      expect(alert).not.toHaveTextContent('账号或密码不正确');
      expect(alert).not.toHaveTextContent(message);
      expect(alert).not.toHaveTextContent(appCode);
      expect(alert).not.toHaveTextContent(code);
    },
  );

  it('shows English copy when the server message is the Chinese production sentence', async () => {
    rootStore.locale.setLocale('en-US');
    const user = userEvent.setup();
    const serverText = '出了点问题，请稍后再试';
    mutateMock.mockImplementationOnce(
      (
        _input: unknown,
        callbacks: {
          onError: (error: { message: string; data?: { code?: string; appCode?: string } }) => void;
        },
      ) => {
        callbacks.onError({
          message: serverText,
          data: { code: 'INTERNAL_SERVER_ERROR', appCode: 'NOT_A_REAL_CODE' },
        });
      },
    );
    renderShell();

    await user.type(screen.getByLabelText(/撰写评论|Write a comment/), 'wow');
    await user.click(screen.getByRole('button', { name: /发布评论|Post comment/ }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong. Try again later.');
    expect(alert).not.toHaveTextContent(serverText);
    expect(alert).not.toHaveTextContent('NOT_A_REAL_CODE');
    expect(alert).not.toHaveTextContent('INTERNAL_SERVER_ERROR');
  });

  it('clears the session and returns to login when posting a comment is rejected', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('jwt.token', { id: 'u1', username: 'alice' });
    mutateMock.mockImplementationOnce(
      (
        _input: unknown,
        callbacks: {
          onError: (error: { message: string; data?: { code?: string; appCode?: string } }) => void;
        },
      ) => {
        callbacks.onError({
          message: 'UNAUTHORIZED',
          data: { code: 'UNAUTHORIZED', appCode: APP_ERROR_CODES.UNAUTHORIZED },
        });
      },
    );
    render(
      <MemoryRouter initialEntries={['/cards/aurora-knight']}>
        <CommentSection target={{ kind: 'card', slug: 'aurora-knight' }} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/撰写评论/), 'still here');
    await user.click(screen.getByRole('button', { name: /发布评论/ }));

    expect(rootStore.session.token).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/login|{"from":"/cards/aurora-knight","notice":"sessionExpired"}',
    );
    expect(screen.queryByText('UNAUTHORIZED')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows localized copy for any other comment error and hides the raw payload', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('jwt.token', { id: 'u1', username: 'alice' });
    mutateMock.mockImplementationOnce(
      (
        _input: unknown,
        callbacks: { onError: (error: { message: string; data?: { code?: string } }) => void },
      ) => {
        callbacks.onError({
          message: 'UNAUTHORIZED',
          data: { code: 'UNAUTHORIZED' },
        });
      },
    );
    renderShell();

    await user.type(screen.getByLabelText(/撰写评论/), 'wow');
    await user.click(screen.getByRole('button', { name: /发布评论/ }));

    expect(screen.getByRole('alert')).toHaveTextContent('出了点问题，请稍后再试');
    expect(screen.getByRole('alert')).not.toHaveTextContent('UNAUTHORIZED');
    expect(rootStore.session.token).toBe('jwt.token');
  });

  it('replaces the composer with a notice when the account is banned', () => {
    rootStore.session.signIn('jwt.token', {
      id: 'u1',
      username: 'alice',
      bannedAt: '2026-10-27T00:00:00.000Z',
    });
    renderShell();
    const notice = screen.getByText('你的账号已被封禁，不能发表评论。');
    expect(notice).not.toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('button', { name: '发布评论' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '举报' })).not.toBeInTheDocument();
  });

  it('keeps the draft and shows the ban sentence when a write returns USER_BANNED', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('jwt.token', { id: 'u1', username: 'alice' });
    mutateMock.mockImplementationOnce((_input, callbacks) => {
      callbacks.onError({
        message: 'PrismaClientKnownRequestError LEAK',
        data: { code: 'FORBIDDEN', appCode: APP_ERROR_CODES.USER_BANNED },
      });
    });
    renderShell();
    const field = screen.getByLabelText(/撰写评论/);
    await user.type(field, 'keep this');
    await user.click(screen.getByRole('button', { name: /发布评论/ }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('你的账号已被封禁，这次操作没有完成。');
    expect(alert).not.toHaveTextContent('LEAK');
    expect(alert).not.toHaveTextContent('Prisma');
    expect(field).toHaveValue('keep this');
  });
});

describe('CommentSection replies', () => {
  const thread = {
    id: '11111111-1111-4111-8111-111111111111',
    content: 'top comment',
    createdAt: '2026-05-01T00:00:00.000Z',
    user: { id: 'u2', username: 'bob' },
    replyCount: 1,
    repliesNextCursor: null,
    replies: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        content: 'older reply',
        createdAt: '2026-05-01T01:00:00.000Z',
        user: { id: 'u3', username: 'cara' },
      },
    ],
  };

  beforeEach(() => {
    rootStore.session.signIn('jwt.token', { id: 'u1', username: 'alice' });
    queryState.data = [thread];
  });

  it('keeps the reply button enabled and rejects an empty reply without a request', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: '回复 @bob' }));
    const field = screen.getByRole('textbox', { name: '回复 @bob' });
    expect(field).toHaveFocus();
    const submit = screen.getByRole('button', { name: '回复' });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('写点内容再回复');
    expect(field).toHaveFocus();

    await user.type(field, '@cara');
    await user.click(submit);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('appends a successful reply without reloading the list', async () => {
    const user = userEvent.setup();
    mutateMock.mockImplementation((input, callbacks) => {
      callbacks.onSuccess(
        {
          id: 'r-new',
          content: input.content,
          createdAt: '2026-05-01T02:00:00.000Z',
          user: { id: 'u1', username: 'alice' },
        },
        input,
      );
    });
    renderShell();
    await user.click(screen.getByRole('button', { name: '回复 @bob' }));
    await user.type(screen.getByRole('textbox', { name: '回复 @bob' }), 'looks good');
    await user.click(screen.getByRole('button', { name: '回复' }));
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      cardSlug: 'aurora-knight',
      content: 'looks good',
      parentId: '11111111-1111-4111-8111-111111111111',
    });
    expect(utilsInvalidate).not.toHaveBeenCalled();
    const posted = document.getElementById('reply-r-new');
    expect(posted).toHaveTextContent('looks good');
    expect(posted).toHaveFocus();
    expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).not.toHaveFocus();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('回复已发布');
    expect(status).toHaveClass('sr-only');
    expect(screen.getByText('2 条回复')).toBeInTheDocument();
  });

  it('focuses the new reply li after it mounts, not its delete button', async () => {
    const user = userEvent.setup();
    mutateMock.mockImplementation((input, callbacks) => {
      callbacks.onSuccess(
        {
          id: 'mounted',
          content: input.content,
          createdAt: '2026-05-01T02:00:00.000Z',
          user: { id: 'u1', username: 'alice' },
        },
        input,
      );
    });
    renderShell();
    await user.click(screen.getByRole('button', { name: '回复 @bob' }));
    await user.type(screen.getByRole('textbox', { name: '回复 @bob' }), 'mounted focus');
    await user.click(screen.getByRole('button', { name: '回复' }));
    const posted = document.getElementById('reply-mounted');
    expect(posted?.tagName).toBe('LI');
    expect(document.activeElement).toBe(posted);
    expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).not.toHaveFocus();
  });

  it('sizes delete with the other actions and wraps a reply author instead of truncating it', () => {
    rootStore.session.signIn('jwt.token', { id: 'u2', username: 'bob', role: 'admin' });
    renderShell();
    expect(screen.getByRole('button', { name: '删除 @bob 的评论' })).toHaveClass('text-xs', 'text-red-700');
    const author = screen.getByText('@cara');
    expect(author).toHaveClass('wrap-anywhere');
    expect(author).not.toHaveClass('truncate');
    expect(screen.getByRole('button', { name: '删除 @cara 的评论' })).toHaveClass('text-xs', 'text-red-700');
    expect(screen.getAllByText('0 / 500')[0]).toHaveClass('text-neutral-600');
    expect(screen.getAllByRole('button', { name: '举报' })[0]).toHaveClass('text-neutral-600');
    expect(screen.getByText('top comment').previousElementSibling).toHaveClass('text-neutral-600');
  });

  it('prefills a mention when replying to a reply and returns focus on Escape', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: '回复 @cara' }));
    const field = screen.getByRole('textbox', { name: '回复 @cara' });
    expect(field).toHaveValue('@cara ');
    expect((field as HTMLTextAreaElement).selectionStart).toBe('@cara '.length);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: '回复 @cara' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回复 @cara' })).toHaveFocus();
  });

  it('shows parentGone without retry, refreshes, and focuses the section title', async () => {
    const user = userEvent.setup();
    mutateMock.mockImplementation((input, callbacks) => {
      callbacks.onError(
        {
          message: '这条评论已被删除，无法回复',
          data: { code: 'NOT_FOUND', appCode: APP_ERROR_CODES.COMMENT_PARENT_GONE },
        },
        input,
      );
    });
    render(
      <MemoryRouter>
        <h3 id="comment-section-title" tabIndex={-1}>
          评论区
        </h3>
        <CommentSection target={{ kind: 'card', slug: 'aurora-knight' }} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '回复 @bob' }));
    await user.type(screen.getByRole('textbox', { name: '回复 @bob' }), 'still here');
    await user.click(screen.getByRole('button', { name: '回复' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('这条评论已被删除，无法回复');
    expect(alert).not.toHaveTextContent('重试');
    expect(screen.queryByRole('textbox', { name: '回复 @bob' })).not.toBeInTheDocument();
    expect(utilsInvalidate).toHaveBeenCalled();
    expect(document.getElementById('comment-section-title')).toHaveFocus();
  });

  it('loads the rest of the replies and reports a failure in place', async () => {
    const user = userEvent.setup();
    queryState.data = [
      {
        ...thread,
        replyCount: 4,
        repliesNextCursor: '33333333-3333-4333-8333-333333333333',
        replies: [
          thread.replies[0]!,
          {
            id: '44444444-4444-4444-8444-444444444444',
            content: 'second',
            createdAt: '2026-05-01T01:10:00.000Z',
            user: { id: 'u2', username: 'bob' },
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            content: 'third',
            createdAt: '2026-05-01T01:20:00.000Z',
            user: { id: 'u3', username: 'cara' },
          },
        ],
      },
    ];
    listRepliesFetch.mockRejectedValueOnce(new Error('nope'));
    renderShell();
    await user.click(screen.getByRole('button', { name: '展开其余 1 条回复' }));
    expect(listRepliesFetch).toHaveBeenCalledWith({
      parentId: '11111111-1111-4111-8111-111111111111',
      cursor: '33333333-3333-4333-8333-333333333333',
      limit: 20,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('回复加载失败');
    expect(screen.getByText('older reply')).toBeInTheDocument();

    listRepliesFetch.mockResolvedValueOnce({
      items: [
        {
          id: 'r4',
          content: 'fourth',
          createdAt: '2026-05-01T01:30:00.000Z',
          user: { id: 'u1', username: 'alice' },
        },
      ],
      nextCursor: null,
    });
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(screen.getByText('fourth')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开其余/ })).not.toBeInTheDocument();
    expect(document.getElementById('reply-r4')).toHaveFocus();
  });

  it('hides reply when signed out and does not render an empty reply list', () => {
    rootStore.session.signOut();
    queryState.data = [
      {
        ...thread,
        replyCount: 0,
        replies: [],
      },
    ];
    renderShell();
    expect(screen.queryByRole('button', { name: /回复 @/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '对 @bob 的回复' })).not.toBeInTheDocument();
    expect(screen.queryByText('暂无回复')).not.toBeInTheDocument();
    expect(screen.queryByText(/条回复/)).not.toBeInTheDocument();
  });

  it('submits a series reply with Ctrl+Enter and keeps the composer busy until it settles', async () => {
    const user = userEvent.setup();
    mutateMock.mockImplementation(() => undefined);
    renderSeriesShell();
    await user.click(screen.getByRole('button', { name: '回复 @bob' }));
    const field = screen.getByRole('textbox', { name: '回复 @bob' });
    await user.type(field, 'series note');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      seriesSlug: 'sky-dawn',
      content: 'series note',
      parentId: thread.id,
    });
    expect(screen.getByRole('button', { name: '发送中…' })).toBeDisabled();
    expect(field).toHaveAttribute('readonly');
    expect(field.closest('form')).toHaveAttribute('aria-busy', 'true');
  });

  it('removes a reply and focuses the visible deleted status', async () => {
    rootStore.session.signIn('jwt.token', { id: 'u3', username: 'cara' });
    const user = userEvent.setup();
    deleteMutateMock.mockImplementation((_input, callbacks) => {
      callbacks.onSuccess();
    });
    renderShell();
    await user.click(screen.getByRole('button', { name: '删除 @cara 的评论' }));
    expect(screen.queryByLabelText('删除原因（选填，只有管理员能看到）')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('回复已删除');
    expect(status).toHaveClass('bg-emerald-50');
    expect(status).toHaveFocus();
    expect(screen.queryByText('older reply')).not.toBeInTheDocument();
    expect(screen.queryByText(/条回复/)).not.toBeInTheDocument();
  });

  it('asks an admin for a reason before deleting someone else’s reply', async () => {
    rootStore.session.signIn('jwt.token', { id: 'admin', username: 'admin', role: 'admin' });
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: '删除 @cara 的评论' }));
    expect(screen.getByLabelText('删除原因（选填，只有管理员能看到）')).toBeInTheDocument();
    expect(screen.getByText('删除这条回复？')).toBeInTheDocument();
  });

  it('confirms deleting a top-level comment together with its replies', async () => {
    rootStore.session.signIn('jwt.token', { id: 'u2', username: 'bob' });
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: '删除 @bob 的评论' }));
    expect(screen.getByText('删除这条评论？它的 1 条回复也会一起删除。')).toBeInTheDocument();
  });
});
