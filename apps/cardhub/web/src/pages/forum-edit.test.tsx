import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../stores/root-store';

const updateMutate = vi.fn();
const topicInvalidate = vi.fn();
const topicsListInvalidate = vi.fn();

type TopicFixture = {
  id: string;
  slug: string;
  title: string;
  body: string;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  editableUntil: string;
  serverNow: string;
  author: { id: string; username: string };
  replyCount: number;
  replies: [];
  replyNextCursor: null;
};

const topicState: {
  isLoading: boolean;
  isError: boolean;
  error: { data?: { code?: string } } | null;
  data: TopicFixture | undefined;
  refetch: () => void;
} = {
  isLoading: false,
  isError: false,
  error: null,
  data: undefined,
  refetch: vi.fn(),
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
    forum: {
      topics: {
        bySlug: {
          useQuery: () => topicState,
        },
        update: {
          useMutation: ({
            onSuccess,
            onError,
          }: {
            onSuccess?: () => void | Promise<void>;
            onError?: (error: { data?: { code?: string } }) => void;
          }) => ({
            mutate: (input: unknown) => updateMutate(input, { onSuccess, onError }),
            isPending: false,
          }),
        },
        list: {
          invalidate: vi.fn(),
        },
      },
    },
    useUtils: () => ({
      forum: {
        topics: {
          bySlug: { invalidate: topicInvalidate },
          list: { invalidate: topicsListInvalidate },
        },
      },
    }),
  },
}));

import { ForumEditPage } from './forum-edit';

function LoginProbe() {
  const location = useLocation();
  return <p>login:{String((location.state as { from?: string } | null)?.from)}</p>;
}

function makeTopic(overrides: Partial<TopicFixture> = {}): TopicFixture {
  return {
    id: overrides.id ?? '11111111-1111-4111-a111-111111111111',
    slug: overrides.slug ?? 'test-topic',
    title: overrides.title ?? 'Original title',
    body: overrides.body ?? 'Original body',
    pinned: overrides.pinned ?? false,
    editedAt: overrides.editedAt ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    editableUntil: overrides.editableUntil ?? new Date(Date.now() + 5 * 60_000).toISOString(),
    serverNow: overrides.serverNow ?? new Date().toISOString(),
    author: overrides.author ?? { id: 'author-1', username: 'author' },
    replyCount: overrides.replyCount ?? 0,
    replies: [],
    replyNextCursor: null,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forum/test-topic/edit']}>
      <Routes>
        <Route path="/forum/:slug/edit" element={<ForumEditPage />} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('jwt.token', { id: 'author-1', username: 'author' });
  topicState.isLoading = false;
  topicState.isError = false;
  topicState.error = null;
  topicState.data = makeTopic();
  updateMutate.mockReset();
  topicInvalidate.mockReset();
  topicsListInvalidate.mockReset();
});

describe('ForumEditPage', () => {
  it('disables save when title and body are unchanged', () => {
    renderPage();

    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
    expect(document.title).toBe('编辑话题 · Cardhub');
  });

  it('uses the English document title', () => {
    rootStore.locale.setLocale('en-US');
    renderPage();
    expect(document.title).toBe('Edit topic · Cardhub');
  });

  it('keeps the edited body and shows amber alert when the server returns FORBIDDEN', async () => {
    updateMutate.mockImplementation((_input, handlers) => {
      handlers.onError?.({ data: { code: 'FORBIDDEN' } });
    });
    const user = userEvent.setup();
    renderPage();

    const body = screen.getByLabelText('正文');
    await user.clear(body);
    await user.type(body, 'Draft that should remain');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('已超过 5 分钟编辑时限');
    expect(screen.getByDisplayValue('Draft that should remain')).toBeInTheDocument();
  });

  it('shows not-allowed state for non-owners', () => {
    rootStore.session.signIn('jwt.token', { id: 'someone-else', username: 'bob' });

    renderPage();

    expect(screen.getByText('这个话题已不能编辑')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回话题' })).toBeInTheDocument();
  });

  it('redirects anonymous users to login with from state', async () => {
    rootStore.session.signOut();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('login:/forum/test-topic/edit')).toBeInTheDocument();
    });
  });
});
