import './test-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { rootStore } from '../../stores/root-store';
import { auditMock, resetAuditMock } from './audit-trpc-mock';
import type { AuditRow } from './audit';

vi.mock('../../lib/trpc', async () => {
  const mod = await import('./audit-trpc-mock');
  return mod.auditTrpcMock;
});

import { AdminAuditPage } from './audit';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.search}</div>;
}

function renderPage(entry = '/admin/audit') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/admin/audit"
          element={
            <>
              <AdminAuditPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'audit-1',
    createdAt: '2026-10-27T01:02:00.000Z',
    action: 'USER_BAN',
    actorId: 'admin',
    actorUsername: 'mod',
    targetType: 'USER',
    targetId: 'user-1',
    targetLabel: 'alice',
    targetUserId: 'user-1',
    targetUsername: 'alice',
    reason: '多次骚扰',
    ...overrides,
  };
}

function setRows(items: AuditRow[]) {
  auditMock.data = {
    pages: [{ items, total: items.length, nextCursor: null }],
    pageParams: [null],
  };
}

beforeEach(() => {
  resetAuditMock();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  rootStore.locale.setLocale('zh-CN');
  rootStore.session.signIn('token', { id: 'admin', username: 'admin', role: 'admin' });
});

describe('AdminAuditPage', () => {
  it('renders the four actions, a snapshot without a link, and an empty reason', () => {
    const longReply = '这张卡的强度已经超过同费用的其他选择'.repeat(3);
    setRows([
      auditRow(),
      auditRow({
        id: 'audit-2',
        action: 'USER_UNBAN',
        reason: '误封',
      }),
      auditRow({
        id: 'audit-3',
        action: 'CONTENT_DELETE',
        targetType: 'REPLY',
        targetId: 'reply-1',
        targetLabel: longReply,
        targetUsername: 'alice',
        reason: null,
      }),
      auditRow({
        id: 'audit-4',
        action: 'REPORT_RESOLVE',
        targetType: 'REPORT',
        targetId: 'report-1',
        targetLabel: 'TOPIC',
        targetUsername: 'alice',
        reason: '已看过',
      }),
    ]);
    renderPage();
    const table = screen.getByRole('table', { name: '操作记录' });
    expect(within(table).getByText('封禁')).toBeInTheDocument();
    expect(within(table).getByText('解封')).toBeInTheDocument();
    expect(within(table).getByText('删除内容')).toBeInTheDocument();
    expect(within(table).getByText('处理举报')).toBeInTheDocument();
    expect(within(table).getByText('未填写')).toHaveClass('text-neutral-500');

    const reply = within(table).getByText(/回帖 · /);
    expect(reply).toHaveClass('wrap-anywhere');
    expect(reply.closest('a')).toBeNull();
    const snapshot = (reply.textContent ?? '').replace(/^回帖 · /, '').replace(/…$/, '');
    expect(reply.textContent?.endsWith('…')).toBe(true);
    expect(Array.from(snapshot)).toHaveLength(40);
    expect(within(table).getByText('作者 @alice')).toBeInTheDocument();

    const userLinks = within(table).getAllByRole('link', { name: '@alice' });
    expect(userLinks).toHaveLength(2);
    for (const link of userLinks) {
      expect(link).toHaveAttribute('href', '/admin/users?q=alice');
    }
    expect(within(table).getByRole('link', { name: '举报 · 话题' })).toHaveAttribute(
      'href',
      '/reports',
    );
    expect(within(table).getAllByText('@mod').length).toBeGreaterThan(0);
  });

  it('shows the user chip from the URL and returns focus to the action select', async () => {
    const user = userEvent.setup();
    setRows([auditRow()]);
    renderPage('/admin/audit?user=alice');
    expect(auditMock.inputs[0]).toEqual({ limit: 50, user: 'alice' });
    expect(screen.getByText('对象：@alice')).toBeInTheDocument();
    expect(screen.getByText('对象：@alice').closest('span')).toHaveClass('bg-brand-50');

    await user.click(screen.getByRole('button', { name: '清除对象筛选' }));
    expect(screen.getByRole('combobox', { name: '操作类型' })).toHaveFocus();
    expect(screen.getByTestId('loc').textContent).toBe('');
    expect(auditMock.inputs.at(-1)).toEqual({ limit: 50 });
  });

  it('filters by action and clears a filtered empty table', async () => {
    const user = userEvent.setup();
    setRows([auditRow()]);
    renderPage();
    await user.click(screen.getByRole('combobox', { name: '操作类型' }));
    await user.click(screen.getByRole('option', { name: '删除内容' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('action=CONTENT_DELETE');
    expect(auditMock.inputs.at(-1)).toEqual({ limit: 50, action: 'CONTENT_DELETE' });

    cleanup();
    setRows([]);
    renderPage('/admin/audit?action=USER_BAN&user=ghost');
    expect(screen.getByText('没有符合条件的记录')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('combobox', { name: '操作类型' })).toHaveFocus();
    expect(screen.getByTestId('loc').textContent).toBe('');
  });

  it('shows the empty state, the error box, and the revoked view', async () => {
    renderPage();
    expect(screen.getByText('还没有操作记录')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    cleanup();
    auditMock.isError = true;
    auditMock.error = { message: 'PrismaClientKnownRequestError LEAK' };
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Prisma');
    expect(screen.getByRole('alert')).not.toHaveTextContent('LEAK');

    cleanup();
    auditMock.error = { message: 'secret', data: { code: 'FORBIDDEN' } };
    renderPage();
    expect(await screen.findByText('仅管理员可以管理内容')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});
