import { QueryClient } from '@tanstack/react-query';
import { applyApproval, applyTask, detailKey, matchesFilter, pendingKey } from '../src/api/cache';
import { toTaskListFilter } from '../src/lib/list-filter';
import { approval, task } from './fixtures';

describe('applyTask', () => {
  it('忽略比详情旧的推送，新的会替换列表并在过期时移出', () => {
    const qc = new QueryClient();
    const current = task();
    qc.setQueryData(detailKey(current.id), { ...current, turns: [], approvals: [] });
    qc.setQueryData(['tasks', 'list', { archived: false }], {
      pages: [{ items: [current], nextCursor: null }],
      pageParams: [null],
    });
    applyTask(qc, task({ title: '旧的', updatedAt: '2026-10-28T03:14:00.000Z' }));
    expect(qc.getQueryData<{ title: string }>(detailKey(current.id))?.title).toBe('修复空指针');

    const newer = task({ title: '新的', updatedAt: '2026-10-28T03:16:00.000Z', status: 'running' });
    applyTask(qc, newer);
    expect(qc.getQueryData<{ title: string }>(detailKey(current.id))?.title).toBe('新的');

    const archived = task({
      title: '归档了',
      updatedAt: '2026-10-28T03:17:00.000Z',
      archivedAt: '2026-10-28T03:17:00.000Z',
      status: 'completed',
    });
    applyTask(qc, archived);
    const pages = qc.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }> }>([
      'tasks',
      'list',
      { archived: false },
    ]);
    expect(pages?.pages[0]?.items).toEqual([]);
  });

  it('比第一条新就插到最前，更旧则让列表失效', async () => {
    const qc = new QueryClient();
    const filter = { archived: false, status: 'queued,preparing,running' };
    const first = task({ id: 'newer', createdAt: '2026-10-28T04:00:00.000Z' });
    qc.setQueryData(['tasks', 'list', filter], {
      pages: [{ items: [first], nextCursor: null }],
      pageParams: [null],
    });
    const fresh = task({
      id: 'fresh',
      createdAt: '2026-10-28T05:00:00.000Z',
      status: 'running',
    });
    applyTask(qc, fresh);
    const inserted = qc.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }> }>([
      'tasks',
      'list',
      filter,
    ]);
    expect(inserted?.pages[0]?.items.map((item) => item.id)).toEqual(['fresh', 'newer']);

    let invalidated = false;
    qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'invalidate') invalidated = true;
    });
    applyTask(
      qc,
      task({
        id: 'old',
        createdAt: '2026-10-28T01:00:00.000Z',
        status: 'queued',
      }),
    );
    await vi.waitFor(() => expect(invalidated).toBe(true));
  });

  it('toTaskListFilter 和 matchesFilter 用同一套规则', () => {
    const states = [
      { status: 'all' as const, agentId: '', source: '' as const, q: '' },
      { status: 'active' as const, agentId: 'codex', source: 'ui' as const, q: '  修复  ' },
      { status: 'ended' as const, agentId: '', source: '' as const, q: 'x'.repeat(120) },
      { status: 'archived' as const, agentId: '', source: '' as const, q: '' },
    ];
    const samples = [
      task(),
      task({ status: 'running', agentId: 'codex', source: 'ui', title: '修复空指针' }),
      task({ status: 'completed' }),
      task({ status: 'completed', archivedAt: '2026-10-28T05:00:00.000Z' }),
      task({ status: 'failed', title: '别的' }),
    ];
    for (const state of states) {
      const filter = toTaskListFilter(state);
      if (state.status === 'archived') expect(filter.archived).toBe(true);
      if (state.status === 'active') expect(filter.status).toBe('queued,preparing,running');
      if (state.status === 'ended')
        expect(filter.status).toBe('completed,failed,cancelled,interrupted');
      if (state.q.trim()) expect(filter.q?.length).toBeLessThanOrEqual(100);
      for (const sample of samples) {
        expect(typeof matchesFilter(sample, filter)).toBe('boolean');
      }
    }
    const active = toTaskListFilter({
      status: 'active',
      agentId: 'codex',
      source: 'ui',
      q: '修复',
    });
    expect(
      matchesFilter(
        task({ status: 'running', agentId: 'codex', source: 'ui', title: '修复空指针' }),
        active,
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        task({ status: 'completed', agentId: 'codex', source: 'ui', title: '修复空指针' }),
        active,
      ),
    ).toBe(false);
  });

  it('审批按创建时间把最早的放前面，结束后移出待审批', () => {
    const qc = new QueryClient();
    const later = approval({ id: 'later', createdAt: '2026-10-28T03:20:00.000Z' });
    const earlier = approval({ id: 'earlier', createdAt: '2026-10-28T03:10:00.000Z' });
    applyApproval(qc, later);
    applyApproval(qc, earlier);
    const pending = qc.getQueryData<{ items: Array<{ id: string }> }>(pendingKey());
    expect(pending?.items.map((item) => item.id)).toEqual(['earlier', 'later']);
    applyApproval(
      qc,
      approval({ id: 'earlier', status: 'approved', decision: 'allow_once', decidedBy: 'ui' }),
    );
    expect(
      qc.getQueryData<{ items: Array<{ id: string }> }>(pendingKey())?.items.map((item) => item.id),
    ).toEqual(['later']);
  });
});
