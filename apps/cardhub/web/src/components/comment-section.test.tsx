import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';

const utilsInvalidate = vi.fn();
const mutateMock = vi.fn();

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
});
