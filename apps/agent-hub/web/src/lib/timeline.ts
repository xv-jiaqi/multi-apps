import type {
  ApprovalDto,
  DiffStats,
  HubEvent,
  HubEventEnvelope,
  PlanEntry,
  TurnDto,
  UsageInfo,
} from '@agent-hub/contract';
import { canonicalJson } from './guard';

export type TimelineItem =
  | {
      kind: 'session';
      key: string;
      seq: number;
      turnId: string | null;
      nativeSessionId: string;
      model: string | null;
      resumed: boolean;
    }
  | {
      kind: 'message';
      key: string;
      seq: number;
      turnId: string | null;
      itemId: string;
      text: string;
    }
  | {
      kind: 'reasoning';
      key: string;
      seq: number;
      turnId: string | null;
      itemId: string;
      text: string;
    }
  | {
      kind: 'plan';
      key: string;
      seq: number;
      turnId: string | null;
      entries: readonly PlanEntry[];
      explanation: string | null;
    }
  | {
      kind: 'tool';
      key: string;
      seq: number;
      turnId: string | null;
      itemId: string;
      title: string;
      command: string | null;
      output: string;
      status: 'running' | 'completed' | 'failed' | 'declined';
      placeholder: boolean;
    }
  | {
      kind: 'approval';
      key: string;
      seq: number;
      turnId: string | null;
      approval: ApprovalDto;
    }
  | {
      kind: 'notice';
      key: string;
      seq: number;
      turnId: string | null;
      code: string | null;
      level: 'info' | 'warning' | 'error';
      message: string;
      count: number;
    }
  | {
      kind: 'remote';
      key: string;
      seq: number;
      turnId: string | null;
      branch: string;
      headCommit: string;
      newCommits: number;
    };

export type TimelineSnapshot = {
  items: readonly TimelineItem[];
  usage: ReadonlyMap<string, UsageInfo>;
  lastSeq: number;
};

export type TurnSection = {
  turn: TurnDto;
  items: TimelineItem[];
  usage: UsageInfo | null;
};

export type TimelineRow =
  | { type: 'turn-head' | 'turn-foot'; key: string; section: TurnSection }
  | { type: 'item'; key: string; item: TimelineItem };

const EMPTY_SNAPSHOT: TimelineSnapshot = {
  items: [],
  usage: new Map(),
  lastSeq: 0,
};

const MAX_TASKS = 5;

interface TaskState {
  snapshot: TimelineSnapshot;
  seen: Set<number>;
  openedAt: number;
}

export interface TimelineStore {
  apply(envelopes: readonly HubEventEnvelope[]): boolean;
  snapshot(taskId: string): TimelineSnapshot;
  touch(taskId: string): void;
  evict(isOpen: (taskId: string) => boolean): void;
  taskIds(): readonly string[];
}

export function createTimelineStore(): TimelineStore {
  const tasks = new Map<string, TaskState>();
  let clock = 0;

  function ensure(taskId: string): TaskState {
    const existing = tasks.get(taskId);
    if (existing) return existing;
    const created: TaskState = {
      snapshot: EMPTY_SNAPSHOT,
      seen: new Set(),
      openedAt: 0,
    };
    tasks.set(taskId, created);
    return created;
  }

  return {
    apply(envelopes) {
      const byTask = new Map<string, HubEventEnvelope[]>();
      for (const envelope of envelopes) {
        const list = byTask.get(envelope.taskId) ?? [];
        list.push(envelope);
        byTask.set(envelope.taskId, list);
      }
      let changed = false;
      for (const [taskId, batch] of byTask) {
        const state = ensure(taskId);
        const next = applyBatch(state, batch);
        if (next === state) continue;
        tasks.set(taskId, next);
        changed = true;
      }
      return changed;
    },
    snapshot(taskId) {
      return tasks.get(taskId)?.snapshot ?? EMPTY_SNAPSHOT;
    },
    touch(taskId) {
      clock += 1;
      const state = ensure(taskId);
      tasks.set(taskId, { ...state, openedAt: clock });
    },
    evict(isOpen) {
      const closable = [...tasks.entries()].filter(([taskId]) => !isOpen(taskId));
      closable.sort((left, right) => left[1].openedAt - right[1].openedAt);
      while (tasks.size > MAX_TASKS && closable.length > 0) {
        const oldest = closable.shift();
        if (!oldest) break;
        tasks.delete(oldest[0]);
      }
    },
    taskIds() {
      return [...tasks.keys()];
    },
  };
}

export const timeline = createTimelineStore();

function applyBatch(state: TaskState, envelopes: readonly HubEventEnvelope[]): TaskState {
  let items = state.snapshot.items;
  let usage = state.snapshot.usage;
  let lastSeq = state.snapshot.lastSeq;
  const seen = state.seen;
  let changed = false;
  for (const envelope of envelopes) {
    if (seen.has(envelope.seq)) continue;
    seen.add(envelope.seq);
    if (envelope.seq > lastSeq) lastSeq = envelope.seq;
    changed = true;
    const step = applyEvent(items, usage, envelope);
    items = step.items;
    usage = step.usage;
  }
  if (!changed) return state;
  return {
    ...state,
    seen,
    snapshot: { items, usage, lastSeq },
  };
}

function applyEvent(
  items: readonly TimelineItem[],
  usage: ReadonlyMap<string, UsageInfo>,
  envelope: HubEventEnvelope,
): { items: readonly TimelineItem[]; usage: ReadonlyMap<string, UsageInfo> } {
  const event = envelope.event;
  switch (event.type) {
    case 'task.status':
    case 'turn.started':
    case 'turn.completed':
    case 'diff.updated':
      return { items, usage };
    case 'usage.updated':
      return { items, usage: mergeUsage(usage, envelope.turnId, event.usage) };
    case 'session.started':
      return {
        items: [
          ...items,
          {
            kind: 'session',
            key: `session:${envelope.seq}`,
            seq: envelope.seq,
            turnId: envelope.turnId,
            nativeSessionId: event.nativeSessionId,
            model: event.model,
            resumed: event.resumed,
          },
        ],
        usage,
      };
    case 'message.delta':
    case 'message.completed':
      return { items: mergeText(items, envelope, 'message', event), usage };
    case 'reasoning.delta':
    case 'reasoning.completed':
      return { items: mergeText(items, envelope, 'reasoning', event), usage };
    case 'plan.updated':
      return { items: mergePlan(items, envelope, event.entries, event.explanation), usage };
    case 'tool.started':
      return {
        items: mergeTool(items, envelope, event.itemId, {
          title: event.title,
          command: event.command ?? null,
          placeholder: false,
        }),
        usage,
      };
    case 'tool.output.delta':
      return {
        items: mergeTool(items, envelope, event.itemId, { outputDelta: event.text }),
        usage,
      };
    case 'tool.completed':
      return {
        items: mergeTool(items, envelope, event.itemId, {
          status: event.status,
          placeholder: false,
        }),
        usage,
      };
    case 'notice':
      return { items: mergeNotice(items, envelope, event), usage };
    case 'remote.updated':
      return {
        items: [
          ...items,
          {
            kind: 'remote',
            key: `remote:${envelope.seq}`,
            seq: envelope.seq,
            turnId: envelope.turnId,
            branch: event.branch,
            headCommit: event.headCommit,
            newCommits: event.newCommits,
          },
        ],
        usage,
      };
    case 'approval.requested':
      return { items: upsertApproval(items, envelope, event.approval), usage };
    case 'approval.resolved':
      return {
        items: resolveApproval(
          items,
          event.approvalId,
          event.status,
          event.decision,
          event.decidedBy,
        ),
        usage,
      };
    default:
      return assertNever(event);
  }
}

function assertNever(event: never): {
  items: readonly TimelineItem[];
  usage: ReadonlyMap<string, UsageInfo>;
} {
  throw new Error(`未处理的时间线事件：${JSON.stringify(event)}`);
}

function mergeUsage(
  usage: ReadonlyMap<string, UsageInfo>,
  turnId: string | null,
  next: UsageInfo,
): ReadonlyMap<string, UsageInfo> {
  const key = turnId ?? '';
  const current = usage.get(key);
  if (current && canonicalJson(current) === canonicalJson(next)) return usage;
  const copy = new Map(usage);
  copy.set(key, next);
  return copy;
}

function mergeText(
  items: readonly TimelineItem[],
  envelope: HubEventEnvelope,
  kind: 'message' | 'reasoning',
  event: { itemId: string; text: string; type: string },
): readonly TimelineItem[] {
  const index = items.findIndex((item) => item.kind === kind && item.itemId === event.itemId);
  const completed = event.type.endsWith('.completed');
  if (index < 0) {
    const created: TimelineItem =
      kind === 'message'
        ? {
            kind: 'message',
            key: `message:${event.itemId}`,
            seq: envelope.seq,
            turnId: envelope.turnId,
            itemId: event.itemId,
            text: event.text,
          }
        : {
            kind: 'reasoning',
            key: `reasoning:${event.itemId}`,
            seq: envelope.seq,
            turnId: envelope.turnId,
            itemId: event.itemId,
            text: event.text,
          };
    return [...items, created];
  }
  const current = items[index];
  if (!current || (current.kind !== 'message' && current.kind !== 'reasoning')) return items;
  const text = completed ? event.text : current.text + event.text;
  if (text === current.text) return items;
  const copy = items.slice();
  copy[index] = { ...current, text };
  return copy;
}

function mergePlan(
  items: readonly TimelineItem[],
  envelope: HubEventEnvelope,
  entries: readonly PlanEntry[],
  explanation: string | null,
): readonly TimelineItem[] {
  const index = findLastIndex(
    items,
    (item) => item.kind === 'plan' && item.turnId === envelope.turnId,
  );
  if (index < 0) {
    return [
      ...items,
      {
        kind: 'plan',
        key: `plan:${envelope.turnId ?? 'task'}:${envelope.seq}`,
        seq: envelope.seq,
        turnId: envelope.turnId,
        entries,
        explanation,
      },
    ];
  }
  const current = items[index];
  if (!current || current.kind !== 'plan') return items;
  if (
    canonicalJson(current.entries) === canonicalJson(entries) &&
    current.explanation === explanation
  ) {
    return items;
  }
  const copy = items.slice();
  copy[index] = { ...current, entries, explanation };
  return copy;
}

interface ToolPatch {
  title?: string;
  command?: string | null;
  outputDelta?: string;
  status?: 'completed' | 'failed' | 'declined';
  placeholder?: boolean;
}

function mergeTool(
  items: readonly TimelineItem[],
  envelope: HubEventEnvelope,
  itemId: string,
  patch: ToolPatch,
): readonly TimelineItem[] {
  const index = items.findIndex((item) => item.kind === 'tool' && item.itemId === itemId);
  if (index < 0) {
    const created: TimelineItem = {
      kind: 'tool',
      key: `tool:${itemId}`,
      seq: envelope.seq,
      turnId: envelope.turnId,
      itemId,
      title: patch.title ?? '',
      command: patch.command ?? null,
      output: patch.outputDelta ?? '',
      status: patch.status ?? 'running',
      placeholder: patch.placeholder ?? patch.title === undefined,
    };
    return [...items, created];
  }
  const current = items[index];
  if (!current || current.kind !== 'tool') return items;
  const next: TimelineItem = {
    ...current,
    title: patch.title ?? current.title,
    command: patch.command === undefined ? current.command : patch.command,
    output: patch.outputDelta ? current.output + patch.outputDelta : current.output,
    status: patch.status ?? current.status,
    placeholder: patch.placeholder ?? current.placeholder,
  };
  if (
    next.title === current.title &&
    next.command === current.command &&
    next.output === current.output &&
    next.status === current.status &&
    next.placeholder === current.placeholder
  ) {
    return items;
  }
  const copy = items.slice();
  copy[index] = next;
  return copy;
}

function mergeNotice(
  items: readonly TimelineItem[],
  envelope: HubEventEnvelope,
  event: Extract<HubEvent, { type: 'notice' }>,
): readonly TimelineItem[] {
  const code = event.code ?? null;
  const last = items[items.length - 1];
  if (
    last &&
    last.kind === 'notice' &&
    code !== null &&
    last.code === code &&
    last.turnId === envelope.turnId
  ) {
    const copy = items.slice();
    copy[copy.length - 1] = { ...last, count: last.count + 1 };
    return copy;
  }
  return [
    ...items,
    {
      kind: 'notice',
      key: `notice:${envelope.seq}`,
      seq: envelope.seq,
      turnId: envelope.turnId,
      code,
      level: event.level,
      message: event.message,
      count: 1,
    },
  ];
}

function upsertApproval(
  items: readonly TimelineItem[],
  envelope: HubEventEnvelope,
  approval: ApprovalDto,
): readonly TimelineItem[] {
  const index = items.findIndex(
    (item) => item.kind === 'approval' && item.approval.id === approval.id,
  );
  if (index < 0) {
    return [
      ...items,
      {
        kind: 'approval',
        key: `approval:${approval.id}`,
        seq: envelope.seq,
        turnId: envelope.turnId,
        approval,
      },
    ];
  }
  const current = items[index];
  if (!current || current.kind !== 'approval') return items;
  if (canonicalJson(current.approval) === canonicalJson(approval)) return items;
  const copy = items.slice();
  copy[index] = { ...current, approval };
  return copy;
}

function resolveApproval(
  items: readonly TimelineItem[],
  approvalId: string,
  status: ApprovalDto['status'],
  decision: ApprovalDto['decision'],
  decidedBy: ApprovalDto['decidedBy'],
): readonly TimelineItem[] {
  const index = items.findIndex(
    (item) => item.kind === 'approval' && item.approval.id === approvalId,
  );
  if (index < 0) return items;
  const current = items[index];
  if (!current || current.kind !== 'approval') return items;
  if (
    current.approval.status === status &&
    current.approval.decision === decision &&
    current.approval.decidedBy === decidedBy
  ) {
    return items;
  }
  const copy = items.slice();
  copy[index] = {
    ...current,
    approval: { ...current.approval, status, decision, decidedBy },
  };
  return copy;
}

function findLastIndex(
  items: readonly TimelineItem[],
  predicate: (item: TimelineItem) => boolean,
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && predicate(item)) return index;
  }
  return -1;
}

const ENDED_TURN: ReadonlySet<TurnDto['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export function groupByTurn(turns: readonly TurnDto[], snapshot: TimelineSnapshot): TurnSection[] {
  return turns.map((turn) => ({
    turn,
    items: snapshot.items.filter((item) => item.turnId === turn.id),
    usage: snapshot.usage.get(turn.id) ?? null,
  }));
}

export function timelineRows(sections: readonly TurnSection[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const section of sections) {
    rows.push({ type: 'turn-head', key: `turn-head:${section.turn.id}`, section });
    for (const item of section.items) rows.push({ type: 'item', key: item.key, item });
    if (ENDED_TURN.has(section.turn.status)) {
      rows.push({ type: 'turn-foot', key: `turn-foot:${section.turn.id}`, section });
    }
  }
  return rows;
}

export function turnDuration(turn: TurnDto): number | null {
  if (!turn.startedAt || !turn.endedAt) return null;
  const start = Date.parse(turn.startedAt);
  const end = Date.parse(turn.endedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

export function formatUsage(usage: UsageInfo | null): string {
  if (!usage) return '';
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`输入 ${usage.inputTokens}`);
  if (usage.outputTokens !== undefined) parts.push(`输出 ${usage.outputTokens}`);
  if (usage.totalTokens !== undefined) parts.push(`合计 ${usage.totalTokens}`);
  return parts.join(' · ');
}

export function formatDiffStats(stats: DiffStats | null): string {
  if (!stats) return '';
  return `${stats.filesChanged} 个文件，+${stats.insertions} -${stats.deletions}`;
}
