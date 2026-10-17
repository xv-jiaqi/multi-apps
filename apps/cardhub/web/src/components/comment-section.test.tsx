import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

const utilsInvalidate = vi.fn();
const mutateMock = vi.fn();
const deleteMutateMock = vi.fn();

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
  isError: boolean;
  error: { message: string } | null;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
};
const mutationState: { isPending: boolean } = { isPending: false };

vi.mock('../lib/trpc', () => {
  return {
    trpc: {
      comments: {
        listForCard: {
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
        delete: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: () => void;
            onError?: (e: { message: string; data?: { code?: string } }, variables: { id: string }) => void;
          }) => ({
            mutate: (input: { id: string }) => deleteMutateMock(input, { onSuccess, onError }),
            isPending: false,
            variables: undefined,
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
        comments: { listForCard: { invalidate: utilsInvalidate } },
      }),
    },
  };
});

import { CommentSection } from './comment-section';

function renderShell() {
  return render(
    <MemoryRouter>
      <CommentSection cardSlug="aurora-knight" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  utilsInvalidate.mockClear();
  mutateMock.mockClear();
  deleteMutateMock.mockClear();
  rootStore.session.signOut();
  queryState.data = [];
  queryState.isLoading = false;
  queryState.isError = false;
  queryState.error = null;
  mutationState.isPending = false;
});

describe('CommentSection (unauthenticated)', () => {
  it('renders the sign-in prompt and no form', () => {
    renderShell();
    expect(screen.getByRole('link', { name: /登录后即可发表评论/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /发布评论/ })).not.toBeInTheDocument();
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
    expect(
      screen.getByRole('button', { name: '删除 @alice 的评论' }),
    ).toBeInTheDocument();
    unmount();

    rootStore.session.signIn('jwt.token', { id: 'u2', username: 'bob', role: 'admin' });
    const adminRender = renderShell();
    expect(
      screen.getByRole('button', { name: '删除 @alice 的评论' }),
    ).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: '删除 @alice 的评论' })).toHaveFocus();
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
