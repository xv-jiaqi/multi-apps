import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

const utilsInvalidate = vi.fn();
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
        },
      }),
    },
  };
});

import { CommentSection } from './comment-section';

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
      expect(bars[0]).toHaveClass('h-3', 'w-24');
      expect(bars[0]).not.toHaveClass('h-6');
      expect(bars[0]?.parentElement).toHaveClass('flex', 'h-6', 'items-center');
      expect(bars[1]).toHaveClass('h-4', 'w-full');
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
      expect(alert).toHaveTextContent('加载失败');
      expect(alert).not.toHaveTextContent('Internal server error');
      expect(alert).toHaveClass('border-red-200', 'bg-red-50', 'text-red-700');

      await user.click(screen.getByRole('button', { name: '重试' }));
      expect(refetchMock).toHaveBeenCalledTimes(1);

      act(() => {
        rootStore.locale.setLocale('en-US');
      });
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load');
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      });
    },
  );

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
        callbacks: { onError: (error: { message: string; data?: { code?: string } }) => void },
      ) => {
        callbacks.onError({
          message: 'Too many requests',
          data: { code: 'TOO_MANY_REQUESTS' },
        });
      },
    );
    renderShell();

    await user.type(screen.getByLabelText(/撰写评论/), 'wow');
    await user.click(screen.getByRole('button', { name: /发布评论/ }));

    expect(screen.getByRole('alert')).toHaveTextContent('评论太频繁，请稍后再试');
    expect(screen.getByLabelText(/撰写评论/)).toHaveValue('wow');
  });
});
