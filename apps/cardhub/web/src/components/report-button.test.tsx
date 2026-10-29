import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { rootStore } from '../stores/root-store';
import { ReportButton } from './report-button';

const harness = vi.hoisted(() => ({
  onSuccess: undefined as (() => void) | undefined,
  onError: undefined as ((error: unknown) => void) | undefined,
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    reports: {
      create: {
        useMutation: (options?: { onSuccess?: () => void; onError?: (error: unknown) => void }) => {
          harness.onSuccess = options?.onSuccess;
          harness.onError = options?.onError;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));

function renderReport() {
  render(
    <MemoryRouter>
      <div className="flex w-[200px] flex-wrap">
        <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001">
          {({ trigger, form }) => (
            <>
              <div className="flex items-center gap-2">{trigger}</div>
              {form}
            </>
          )}
        </ReportButton>
      </div>
    </MemoryRouter>,
  );
}

const reasonTooShortError = {
  message: '填写的内容不符合要求，请修改后再试',
  data: {
    code: 'BAD_REQUEST',
    appCode: 'VALIDATION',
    zodError: {
      issues: [{ path: ['reason'], message: 'reason_too_short', code: 'too_small', minimum: 4 }],
    },
  },
};

beforeEach(() => {
  harness.onSuccess = undefined;
  harness.onError = undefined;
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'u1', username: 'qa_user', role: 'user' });
});

describe('report form focus', () => {
  it('gives the logged-out report link the same trigger classes', () => {
    rootStore.session.signOut();
    renderReport();
    expect(screen.getByRole('link', { name: '举报' })).toHaveClass(
      'hover:underline',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
    );
  });

  it('moves focus into the textarea and back to the report button', async () => {
    const user = userEvent.setup();
    renderReport();
    const open = screen.getByRole('button', { name: '举报' });
    await user.click(open);
    const textarea = await screen.findByRole('textbox');
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).toHaveAttribute('aria-controls', document.querySelector('form')?.id);

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.activeElement).toBe(open);
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(open).toHaveAttribute('aria-expanded', 'false');

    await user.click(open);
    await user.type(screen.getByRole('textbox'), '暂存的原因');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(open);
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(open);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('gives the cancel button the same focus ring as the report button', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: '举报' }));
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(cancel).toHaveClass(
      'min-h-6',
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-brand-500',
    );
  });

  it('shows a server reason_too_short error under the reason field', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: '举报' }));
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'long enough');
    await user.click(screen.getByRole('button', { name: '提交举报' }));
    await act(async () => {
      harness.onError?.(reasonTooShortError);
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('原因至少 4 个字符');
    expect(alert).not.toHaveTextContent('填写的内容不符合要求，请修改后再试');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-describedby', alert.id);
  });

  it('shows the English reason_too_short sentence under the reason field', async () => {
    rootStore.locale.setLocale('en-US');
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: 'Report' }));
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'long enough');
    await user.click(screen.getByRole('button', { name: 'Submit report' }));
    await act(async () => {
      harness.onError?.(reasonTooShortError);
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Use at least 4 characters for the reason.');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-describedby', alert.id);
  });

  it('returns focus to the textarea when the reason is too short', async () => {
    const user = userEvent.setup();
    renderReport();
    await user.click(screen.getByRole('button', { name: '举报' }));
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'abc');
    await user.click(screen.getByRole('button', { name: '提交举报' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('原因至少 4 个字符');
    expect(textarea).toHaveAttribute('aria-describedby', alert.id);
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it('focuses the success status and keeps Escape inside the form', async () => {
    const user = userEvent.setup();
    const parentKey = vi.fn();
    render(
      <MemoryRouter>
        <div onKeyDown={parentKey}>
          <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001" />
        </div>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: '举报' }));
    await user.type(screen.getByRole('textbox'), 'long enough reason');
    parentKey.mockClear();
    await user.keyboard('{Escape}');
    expect(parentKey).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '举报' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '举报' }));
    await user.type(screen.getByRole('textbox'), 'long enough reason');
    await user.click(screen.getByRole('button', { name: '提交举报' }));
    harness.onSuccess?.();
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('举报已提交');
    expect(status).toHaveAttribute('tabindex', '-1');
    await waitFor(() => {
      expect(document.activeElement).toBe(status);
    });
    expect(screen.queryByRole('button', { name: '举报' })).not.toBeInTheDocument();
  });

  it('still renders caller actions when the account is banned', () => {
    rootStore.session.signIn('token', {
      id: 'u1',
      username: 'qa_user',
      role: 'user',
      bannedAt: '2026-10-27T00:00:00.000Z',
    });
    render(
      <MemoryRouter>
        <ReportButton targetType="COMMENT" targetId="00000000-0000-4000-8000-000000000001">
          {({ trigger, form }) => (
            <>
              {trigger}
              <button type="button">回复</button>
              {form}
            </>
          )}
        </ReportButton>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: '举报' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回复' })).toBeInTheDocument();
  });
});
