import { APP_ERROR_CODES } from '@repo/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import { bindSessionRefresh } from '../lib/session-refresh';
import { LoginPage } from './login';
import { RegisterPage } from './register';
import { ForumNewPage } from './forum-new';
import { ReportButton } from '../components/report-button';

const harness = vi.hoisted(() => ({
  onError: undefined as
    | ((error: { message: string; data?: { code?: string; appCode?: string } }) => void)
    | undefined,
}));

const idleQuery = vi.hoisted(() => () => ({
  data: undefined,
  isFetching: false,
  isError: false,
  isSuccess: false,
  refetch: vi.fn(),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      forum: { topics: { list: { invalidate: vi.fn() } } },
    }),
    search: { global: { useQuery: idleQuery } },
    auth: {
      register: {
        useMutation: (options?: {
          onError?: (error: {
            message: string;
            data?: { code?: string; appCode?: string };
          }) => void;
        }) => {
          harness.onError = options?.onError;
          return { mutate: vi.fn(), isPending: false };
        },
      },
      login: {
        useMutation: (options?: {
          onError?: (error: {
            message: string;
            data?: { code?: string; appCode?: string };
          }) => void;
        }) => {
          harness.onError = options?.onError;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
    forum: {
      topics: {
        create: {
          useMutation: (options?: {
            onError?: (error: {
              message: string;
              data?: { code?: string; appCode?: string };
            }) => void;
          }) => {
            harness.onError = options?.onError;
            return { mutate: vi.fn(), isPending: false };
          },
        },
      },
    },
    reports: {
      create: {
        useMutation: (options?: {
          onError?: (error: {
            message: string;
            data?: { code?: string; appCode?: string };
          }) => void;
        }) => {
          harness.onError = options?.onError;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));

function show(message: string, appCode: string, code: string) {
  act(() => {
    harness.onError?.({ message, data: { code, appCode } });
  });
}

describe('mapped API error copy', () => {
  beforeEach(() => {
    harness.onError = undefined;
    rootStore.locale.setLocale('zh-CN');
    rootStore.session.signOut();
  });

  it('register shows the conflict sentence instead of the server text or code', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    show('该邮箱已被注册', 'CONFLICT', 'CONFLICT');
    expect(screen.getByText('邮箱或用户名已被使用，请换一个')).toBeInTheDocument();
    expect(screen.queryByText('已经有相同的内容，请修改后再试')).not.toBeInTheDocument();
    expect(screen.queryByText('该邮箱已被注册')).not.toBeInTheDocument();
    expect(screen.queryByText('CONFLICT')).not.toBeInTheDocument();
  });

  it('login in English does not show the Chinese production sentence for an unmapped code', () => {
    rootStore.locale.setLocale('en-US');
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    show('出了点问题，请稍后再试', 'NOT_A_REAL_CODE', 'INTERNAL_SERVER_ERROR');
    expect(screen.getByText('Something went wrong. Try again later.')).toBeInTheDocument();
    expect(screen.queryByText('出了点问题，请稍后再试')).not.toBeInTheDocument();
    expect(screen.queryByText('NOT_A_REAL_CODE')).not.toBeInTheDocument();
    expect(screen.queryByText('INTERNAL_SERVER_ERROR')).not.toBeInTheDocument();
  });

  it('login shows the sign-in sentence instead of the server text or code', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    show('用户名或密码错误', 'INVALID_CREDENTIALS', 'UNAUTHORIZED');
    expect(screen.getByRole('alert')).toHaveTextContent('账号或密码不正确');
    expect(screen.queryByText('登录已失效，请重新登录')).not.toBeInTheDocument();
    expect(screen.queryByText('用户名或密码错误')).not.toBeInTheDocument();
    expect(screen.queryByText('UNAUTHORIZED')).not.toBeInTheDocument();
  });

  it('forum publish shows the validation sentence instead of the server text or code', () => {
    rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
    render(
      <MemoryRouter>
        <ForumNewPage />
      </MemoryRouter>,
    );
    show('标题不能为空', 'VALIDATION', 'BAD_REQUEST');
    expect(screen.getByText('填写的内容不符合要求，请修改后再试')).toBeInTheDocument();
    expect(screen.queryByText('标题不能为空')).not.toBeInTheDocument();
    expect(screen.queryByText('VALIDATION')).not.toBeInTheDocument();
    expect(screen.queryByText('BAD_REQUEST')).not.toBeInTheDocument();
  });

  it('gives the signed-out report link the comment-area focus ring', () => {
    render(
      <MemoryRouter>
        <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: '举报' })).toHaveClass(
      'min-h-6',
      'rounded',
      'text-neutral-600',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
    );
  });

  it('report shows the validation sentence instead of the server text or code', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
    render(
      <MemoryRouter>
        <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001" />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '举报' }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass(
      'min-h-6',
      'rounded',
      'text-neutral-600',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
    );
    show('请简要说明原因，至少 4 个字符', 'VALIDATION', 'BAD_REQUEST');
    expect(screen.getByText('填写的内容不符合要求，请修改后再试')).toBeInTheDocument();
    expect(screen.queryByText('请简要说明原因，至少 4 个字符')).not.toBeInTheDocument();
    expect(screen.queryByText('VALIDATION')).not.toBeInTheDocument();
  });

  it('hides the report button and replaces the topic form when the account is banned', () => {
    rootStore.session.signIn('token', {
      id: 'u1',
      username: 'qa_user',
      role: 'user',
      bannedAt: '2026-10-27T00:00:00.000Z',
    });
    const { unmount } = render(
      <MemoryRouter>
        <ForumNewPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '你的账号已被封禁' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '你的账号已被封禁' })).not.toHaveAttribute(
      'role',
      'alert',
    );
    expect(screen.getByText('你的账号已被封禁，不能发布话题。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回论坛' })).toHaveAttribute('href', '/forum');
    expect(screen.queryByRole('button', { name: '发布话题' })).not.toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '举报' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '举报' })).not.toBeInTheDocument();
  });

  it('shows the ban sentence for USER_BANNED and keeps the topic draft', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
    render(
      <MemoryRouter>
        <ForumNewPage />
      </MemoryRouter>,
    );
    const refresh = vi.fn();
    bindSessionRefresh(refresh);
    await user.type(screen.getByLabelText('标题'), 'still here');
    show('账号已被封禁 Prisma LEAK', APP_ERROR_CODES.USER_BANNED, 'FORBIDDEN');
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('你的账号已被封禁，这次操作没有完成。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Prisma');
    expect(screen.getByRole('alert')).not.toHaveTextContent('FORBIDDEN');
    expect(screen.getByLabelText('标题')).toHaveValue('still here');
  });
});
