import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
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
    expect(screen.getByText('注册没有成功，请换一个邮箱或用户名')).toBeInTheDocument();
    expect(screen.queryByText('这条内容和已有数据冲突，请修改后再试')).not.toBeInTheDocument();
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
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
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
    expect(screen.getByText('登录没有成功，请检查账号和密码')).toBeInTheDocument();
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

  it('report shows the validation sentence instead of the server text or code', async () => {
    const user = userEvent.setup();
    rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
    render(
      <MemoryRouter>
        <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001" />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '举报' }));
    show('请简要说明原因，至少 4 个字符', 'VALIDATION', 'BAD_REQUEST');
    expect(screen.getByText('填写的内容不符合要求，请修改后再试')).toBeInTheDocument();
    expect(screen.queryByText('请简要说明原因，至少 4 个字符')).not.toBeInTheDocument();
    expect(screen.queryByText('VALIDATION')).not.toBeInTheDocument();
  });
});
