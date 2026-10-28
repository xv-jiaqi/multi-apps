import {
  ADAPTER_KINDS,
  APPROVAL_DECISIONS,
  APPROVAL_KINDS,
  APPROVAL_STATUSES,
  DECIDERS,
  DIFF_FILE_STATUS_LABELS,
  SCOPES,
  SCOPE_LABELS,
  STOP_REASONS,
  TASK_MODES,
  TASK_SOURCES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TOOL_KINDS,
  TURN_STATUSES,
  WORKSPACE_KINDS,
  reasoningEffortLabel,
  taskStatusLabel,
} from '@agent-hub/contract';
import { createDefaultConfig } from '@agent-hub/contract';
import { filePatchCollapsed, pairFilePatches } from '../src/lib/patch';
import {
  isDirty,
  newAcpAgent,
  newRepo,
  normalizeBlockedHosts,
  sectionOfIssue,
  uniqueId,
  withRepo,
  withoutRepo,
} from '../src/lib/settings-form';
import {
  DEFAULT_OPTION,
  buildCreateBody,
  buildFollowUpBody,
  followUpBlocker,
  initialForm,
  modelChoices,
  needsInPlaceWriteConfirm,
  readOnlyWithoutSandbox,
  validateForm,
  withAgent,
} from '../src/lib/task-form';
import { createTimelineStore, groupByTurn, timelineRows } from '../src/lib/timeline';
import { agent, approval, envelope, repo, task, turn } from './fixtures';

describe('时间线', () => {
  it('按 seq 去重，拼接增量，工具先到输出时补占位，连续 notice 合并计数', () => {
    const store = createTimelineStore();
    const taskId = task().id;
    const first = envelope({ type: 'message.delta', itemId: 'm1', text: '你' }, { seq: 1 });
    expect(store.apply([first, first])).toBe(true);
    expect(store.apply([first])).toBe(false);
    store.apply([envelope({ type: 'message.delta', itemId: 'm1', text: '好' }, { seq: 2 })]);
    store.apply([envelope({ type: 'message.completed', itemId: 'm1', text: '你好' }, { seq: 3 })]);
    store.apply([
      envelope({ type: 'tool.output.delta', itemId: 'tool-1', text: 'ok' }, { seq: 4 }),
      envelope(
        {
          type: 'tool.started',
          itemId: 'tool-1',
          toolKind: 'command',
          title: '执行命令',
          command: 'ls',
        },
        { seq: 5 },
      ),
    ]);
    store.apply([
      envelope(
        { type: 'notice', level: 'warning', code: 'AGENT_RETRYING', message: '重试' },
        { seq: 6 },
      ),
      envelope(
        { type: 'notice', level: 'warning', code: 'AGENT_RETRYING', message: '又一次' },
        { seq: 7 },
      ),
      envelope({ type: 'task.status', from: 'running', to: 'completed' }, { seq: 8 }),
    ]);
    const snapshot = store.snapshot(taskId);
    const message = snapshot.items.find((item) => item.kind === 'message');
    const tool = snapshot.items.find((item) => item.kind === 'tool');
    const notice = snapshot.items.find((item) => item.kind === 'notice');
    expect(message && message.kind === 'message' ? message.text : '').toBe('你好');
    expect(tool && tool.kind === 'tool' ? [tool.placeholder, tool.title, tool.output] : []).toEqual(
      [false, '执行命令', 'ok'],
    );
    expect(notice && notice.kind === 'notice' ? notice.count : 0).toBe(2);
    expect(snapshot.items.some((item) => item.kind === 'session')).toBe(false);
    expect(snapshot.lastSeq).toBe(8);
    const rows = timelineRows(
      groupByTurn(
        [
          turn({
            status: 'completed',
            stopReason: 'end_turn',
            endedAt: '2026-10-28T03:20:00.000Z',
          }),
        ],
        snapshot,
      ),
    );
    expect(rows[0]?.type).toBe('turn-head');
    expect(rows.at(-1)?.type).toBe('turn-foot');
  });

  it('超过 5 个未打开的时间线就丢掉最久的', () => {
    const store = createTimelineStore();
    for (let index = 0; index < 6; index += 1) {
      store.apply([
        envelope(
          { type: 'notice', level: 'info', message: 'hi' },
          { taskId: `t-${index}`, seq: 1, turnId: null },
        ),
      ]);
    }
    store.evict(() => false);
    expect(store.taskIds()).toHaveLength(5);
    expect(store.taskIds()).not.toContain('t-0');
  });
});

describe('补丁拆分', () => {
  it('按文件拆开，超过 400 行默认折叠', () => {
    const added = 'diff --git a/new.txt b/new.txt\nnew file mode 100644\n+hi\n';
    const modified =
      'diff --git a/old.txt b/old.txt\n--- a/old.txt\n+++ b/old.txt\n@@ -1 +1 @@\n-a\n+b\n';
    const files = pairFilePatches(`${added}${modified}`);
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['new.txt', 'added'],
      ['old.txt', 'modified'],
    ]);
    const long = `diff --git a/big.txt b/big.txt\n${' line\n'.repeat(401)}`;
    const [big] = pairFilePatches(long);
    expect(big).toBeTruthy();
    if (!big) return;
    expect(filePatchCollapsed(big, false)).toBe(true);
    expect(filePatchCollapsed(big, true)).toBe(false);
  });
});

describe('新建任务和追问', () => {
  it('D38 只读无沙箱要提示，可写原目录要确认', () => {
    const acp = agent({
      id: 'qoder',
      kind: 'acp',
      capabilities: {
        models: [],
        modelsSource: 'session',
        sandbox: false,
        resume: true,
        userVisibleSessions: false,
        workspaces: ['in_place', 'worktree'],
        fetchedAt: '2026-10-28T03:00:00.000Z',
      },
    });
    const form = withAgent(initialForm([acp], [repo()]), acp);
    expect(readOnlyWithoutSandbox(acp, form)).toBe(true);
    expect(needsInPlaceWriteConfirm(form)).toBe(false);
    expect(needsInPlaceWriteConfirm({ ...form, mode: 'write', workspace: 'in_place' })).toBe(true);
    expect(
      validateForm({ ...form, prompt: '' }, acp, repo()).some((item) => item.path === 'prompt'),
    ).toBe(true);
    expect(buildCreateBody({ ...form, prompt: '看一下' }, acp).prompt).toBe('看一下');
  });

  it('追问：已归档、未结束、worktree 已清理会拦住；没改不传，改回默认传 null', () => {
    expect(
      followUpBlocker(task({ archivedAt: '2026-10-28T04:00:00.000Z', status: 'completed' })),
    ).toContain('归档');
    expect(followUpBlocker(task({ status: 'running' }))).toContain('还没结束');
    expect(
      followUpBlocker(task({ status: 'completed', worktreeRemovedAt: '2026-10-28T04:00:00.000Z' })),
    ).toContain('worktree');
    const done = task({ status: 'completed', model: 'gpt', reasoningEffort: 'high' });
    expect(followUpBlocker(done)).toBeNull();
    expect(
      buildFollowUpBody(done, { prompt: '继续', model: 'gpt', reasoningEffort: 'high' }),
    ).toEqual({
      prompt: '继续',
    });
    expect(
      buildFollowUpBody(done, {
        prompt: '继续',
        model: DEFAULT_OPTION,
        reasoningEffort: DEFAULT_OPTION,
      }),
    ).toEqual({ prompt: '继续', model: null, reasoningEffort: null });
  });

  it('网页 Agent 不能选模型', () => {
    const web = agent({ id: 'aoned', kind: 'web', capabilities: null });
    expect(modelChoices(web, { defaultModel: null, defaultReasoningEffort: null }, '')).toEqual({
      kind: 'none',
    });
  });
});

describe('设置辅助', () => {
  it('锁定三个 GitHub 主机，分区、id、脏检查和默认仓库', () => {
    expect(normalizeBlockedHosts(['GitHub.com', 'gitlab.example'])).toEqual([
      'github.com',
      'ssh.github.com',
      'gist.github.com',
      'gitlab.example',
    ]);
    expect(sectionOfIssue('agents.1.command')).toBe('agents');
    expect(sectionOfIssue('server.port')).toBe('general');
    expect(uniqueId('仓库', [], 'repo')).toBe('repo');
    const config = createDefaultConfig();
    const created = newRepo('/tmp/demo', repo().inspection, []);
    const withOne = withRepo(config, created);
    expect(withOne.defaultRepoId).toBe(created.id);
    expect(withoutRepo(withOne, created.id).defaultRepoId).toBeNull();
    expect(newAcpAgent([]).command).toBe('');
    expect(isDirty(config, config)).toBe(false);
    expect(isDirty({ ...config, server: { port: 47822 } }, config)).toBe(true);
  });
});

describe('labels', () => {
  it('覆盖 domain.ts 里的枚举，未知推理档原样显示', () => {
    for (const status of TASK_STATUSES)
      expect(TASK_STATUS_LABELS[status].length).toBeGreaterThan(0);
    expect(TASK_STATUSES.map(taskStatusLabel)).toEqual([
      '排队中',
      '准备中',
      '运行中',
      '已完成',
      '失败',
      '已取消',
      '已中断',
    ]);
    for (const value of TURN_STATUSES) expect(taskStatusLabel(value) || value).toBeTruthy();
    expect(TASK_MODES).toEqual(['read_only', 'write']);
    expect(WORKSPACE_KINDS).toHaveLength(3);
    expect(TASK_SOURCES).toEqual(['ui', 'bridge']);
    expect(APPROVAL_KINDS).toHaveLength(4);
    expect(APPROVAL_DECISIONS).toHaveLength(4);
    expect(APPROVAL_STATUSES).toHaveLength(5);
    expect(DECIDERS).toEqual(['ui', 'bridge', 'system']);
    expect(STOP_REASONS).toHaveLength(6);
    expect(ADAPTER_KINDS).toEqual(['codex', 'acp', 'web']);
    expect(TOOL_KINDS).toHaveLength(10);
    expect(Object.keys(DIFF_FILE_STATUS_LABELS)).toEqual([
      'added',
      'modified',
      'deleted',
      'renamed',
    ]);
    for (const scope of SCOPES) expect(SCOPE_LABELS[scope].length).toBeGreaterThan(0);
    expect(reasoningEffortLabel('high')).toBe('高');
    expect(reasoningEffortLabel('custom-x')).toBe('custom-x');
    expect(approval().title).toBe('执行命令');
  });
});
