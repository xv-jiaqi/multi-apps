import { QueryClient } from '@tanstack/react-query';
import { AttentionWatcher, agentDisplayNameFromQuery } from '../src/api/attention-watcher';
import type { TaskHandlers } from '../src/api/socket';
import { agentsQuery } from '../src/api/queries';
import { envelope, task } from './fixtures';

describe('AttentionWatcher 的显示名', () => {
  it('通知标题用 Agent 查询里的 displayName，查询里没有时退回 agentId', () => {
    const qc = new QueryClient();
    qc.setQueryData(agentsQuery().queryKey, {
      items: [{ id: 'codex', displayName: 'Codex 显示名' }],
    });
    expect(agentDisplayNameFromQuery(qc, 'codex')).toBe('Codex 显示名');
    expect(agentDisplayNameFromQuery(qc, 'missing')).toBe('missing');

    const notify = vi.fn();
    let handlers: TaskHandlers | undefined;
    const watcher = new AttentionWatcher({
      subscribeTask: (_taskId, next) => {
        handlers = next;
        return () => undefined;
      },
      notify,
      isBackground: () => true,
      agentDisplayName: (agentId) => agentDisplayNameFromQuery(qc, agentId),
    });
    const running = task({ status: 'running', agentId: 'codex', shortId: '5f0c2a9e' });
    watcher.onTask(running);
    handlers?.onEvent(
      envelope(
        { type: 'task.status', from: 'running', to: 'completed' },
        { ts: new Date().toISOString(), taskId: running.id },
      ),
    );
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]?.[0].title).toContain('Codex 显示名');
    expect(notify.mock.calls[0]?.[0].title).not.toContain('codex 任务');

    qc.removeQueries({ queryKey: agentsQuery().queryKey });
    handlers?.onEvent(
      envelope(
        { type: 'task.status', from: 'running', to: 'failed' },
        { ts: new Date().toISOString(), seq: 2, taskId: running.id },
      ),
    );
    expect(notify.mock.calls[1]?.[0].title).toContain('codex 任务');
  });
});
