// contract/src/events.ts
import type {
  ApprovalDecision,
  ApprovalStatus,
  DecidedBy,
  DiffStats,
  PlanEntry,
  StopReason,
  TaskStatus,
  ToolKind,
  TurnStatus,
  UsageInfo,
} from './domain';
import type { ApprovalDto } from './dto';
import type { AgentError } from './errors';

/** 适配器产出的事件（经 AgentEventSink.emit）。 */
export type AgentEvent =
  | { type: 'session.started'; nativeSessionId: string; model: string | null; resumed: boolean }
  | { type: 'message.delta'; itemId: string; text: string }
  | { type: 'message.completed'; itemId: string; text: string }
  | { type: 'reasoning.delta'; itemId: string; text: string }
  | { type: 'reasoning.completed'; itemId: string; text: string }
  | { type: 'plan.updated'; entries: PlanEntry[]; explanation: string | null }
  | {
      type: 'tool.started';
      itemId: string;
      toolKind: ToolKind;
      /** 一句话中文标题，例如“执行命令”“读取 3 个文件”。 */
      title: string;
      command?: string;
      cwd?: string;
      paths?: string[];
    }
  | { type: 'tool.output.delta'; itemId: string; text: string; truncated?: true }
  | {
      type: 'tool.completed';
      itemId: string;
      status: 'completed' | 'failed' | 'declined';
      exitCode?: number;
      durationMs?: number;
    }
  | { type: 'usage.updated'; usage: UsageInfo }
  /** 网页 Agent：远端任务分支有新提交。 */
  | { type: 'remote.updated'; branch: string; headCommit: string; newCommits: number }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; code?: string; message: string };

/** 核心产出的事件。 */
export type CoreEvent =
  | { type: 'task.status'; from: TaskStatus; to: TaskStatus; reason?: string }
  | {
      type: 'turn.started';
      turnId: string;
      index: number;
      prompt: string;
      model: string | null;
      reasoningEffort: string | null;
    }
  | {
      type: 'turn.completed';
      turnId: string;
      index: number;
      status: TurnStatus;
      stopReason: StopReason;
      error?: AgentError;
    }
  | { type: 'approval.requested'; approval: ApprovalDto }
  | {
      type: 'approval.resolved';
      approvalId: string;
      status: Exclude<ApprovalStatus, 'pending'>;
      decision: ApprovalDecision | null;
      decidedBy: DecidedBy;
    }
  | {
      type: 'diff.updated';
      turnId: string;
      scope: 'turn_end' | 'live';
      task: DiffStats;
      turn: DiffStats;
      patchTruncated: boolean;
    };

export type HubEvent = AgentEvent | CoreEvent;
export type HubEventType = HubEvent['type'];

export const DELTA_EVENT_TYPES = ['message.delta', 'reasoning.delta', 'tool.output.delta'] as const;
export type DeltaEvent = Extract<HubEvent, { type: (typeof DELTA_EVENT_TYPES)[number] }>;

export function isDeltaEvent(event: HubEvent): event is DeltaEvent {
  return (DELTA_EVENT_TYPES as readonly string[]).includes(event.type);
}

export interface HubEventEnvelope {
  taskId: string;
  /** 同一任务内严格递增（可能有空号）。 */
  seq: number;
  /** 所属的轮；任务级事件为 null。 */
  turnId: string | null;
  /** ISO 8601，UTC。 */
  ts: string;
  event: HubEvent;
}
