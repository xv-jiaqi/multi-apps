import type { DiffDto, TaskDetailDto } from '@agent-hub/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../src/api/api';
import { ApiError } from '../src/api/client';
import { taskDiffQuery } from '../src/api/queries';
import { DiffTab } from '../src/pages/task-detail/diff-tab';
import { task, turn } from './fixtures';

const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

function detail(): TaskDetailDto {
  return { ...task({ status: 'running' }), turns: [turn()], approvals: [] };
}

function storedDiff(taskId: string): DiffDto {
  return {
    taskId,
    scope: 'task',
    turnIndex: 1,
    live: false,
    stats: { filesChanged: 1, insertions: 1, deletions: 1, files: [] },
    patch,
    truncated: false,
  };
}

describe('刷新 diff', () => {
  it('失败时保留原 diff 并给出错误和重试，请求过程中先显示处理中', async () => {
    const user = userEvent.setup();
    const current = detail();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(taskDiffQuery(current.id, 'task', null).queryKey, storedDiff(current.id));
    let rejectLive: (error: unknown) => void = () => undefined;
    vi.spyOn(api, 'getTaskDiff').mockImplementation((_id, query) => {
      if (query.live) {
        return new Promise((_resolve, reject) => {
          rejectLive = reject;
        });
      }
      return Promise.resolve(storedDiff(current.id));
    });

    render(
      <QueryClientProvider client={qc}>
        <DiffTab task={current} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('src/a.ts')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新 diff' }));
    expect(screen.getByRole('button', { name: '处理中…' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    rejectLive(new ApiError('INTERNAL', '拉不到实时 diff', 500, null));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('拉不到实时 diff');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.queryByText('正在加载 diff…')).toBeNull();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '处理中…' })).toBeTruthy());
    const loading = screen.getByText('处理中…');
    const shown = screen.queryByRole('alert');
    if (shown) {
      expect(
        shown.compareDocumentPosition(loading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});
