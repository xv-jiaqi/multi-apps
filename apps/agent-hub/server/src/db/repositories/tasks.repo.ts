import type {
  AdapterKind,
  AgentError,
  ApprovalDecision,
  ApprovalDto,
  ApprovalKind,
  ApprovalStatus,
  DecidedBy,
  DiffStats,
  JsonValue,
  StopReason,
  TaskDto,
  TaskMode,
  TaskSource,
  TaskStatus,
  TurnDto,
  TurnStatus,
  UsageInfo,
  WorkspaceKind,
} from '@agent-hub/contract';
import type { Db, SqlValue } from '../sqlite';
import { updateById } from './update';

export interface TaskRow {
  id: string;
  short_id: string;
  title: string;
  agent_id: string;
  adapter_kind: string;
  repo_id: string;
  repo_path: string;
  source: string;
  source_token_id: string | null;
  external_ref: string | null;
  mode: string;
  workspace_kind: string;
  workspace_path: string | null;
  branch: string | null;
  base_ref: string | null;
  base_commit: string | null;
  base_tree: string | null;
  model: string | null;
  reasoning_effort: string | null;
  user_visible: number;
  native_session_id: string | null;
  remote_url: string | null;
  status: string;
  pending_approvals: number;
  turn_count: number;
  last_event_seq: number;
  last_error: string | null;
  read_only_violation: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
  archived_at: string | null;
  worktree_removed_at: string | null;
}

export interface TurnRow {
  id: string;
  task_id: string;
  idx: number;
  prompt: string;
  model: string | null;
  reasoning_effort: string | null;
  status: string;
  stop_reason: string | null;
  error: string | null;
  native_turn_id: string | null;
  before_tree: string | null;
  after_tree: string | null;
  turn_patch: string | null;
  task_patch: string | null;
  turn_stats: string | null;
  task_stats: string | null;
  patch_truncated: number;
  usage: string | null;
  final_message: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface ApprovalRow {
  id: string;
  task_id: string;
  turn_id: string;
  kind: string;
  title: string;
  request: string;
  options: string;
  status: string;
  decision: string | null;
  decided_by: string | null;
  decided_by_token_id: string | null;
  note: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
}

const json = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T));

export function taskToDto(r: TaskRow): TaskDto {
  return {
    id: r.id,
    shortId: r.short_id,
    title: r.title,
    agentId: r.agent_id,
    adapterKind: r.adapter_kind as AdapterKind,
    repoId: r.repo_id,
    repoPath: r.repo_path,
    source: r.source as TaskSource,
    sourceTokenId: r.source_token_id,
    externalRef: r.external_ref,
    mode: r.mode as TaskMode,
    workspace: r.workspace_kind as WorkspaceKind,
    workspacePath: r.workspace_path,
    branch: r.branch,
    baseRef: r.base_ref,
    baseCommit: r.base_commit,
    model: r.model,
    reasoningEffort: r.reasoning_effort,
    userVisible: r.user_visible === 1,
    nativeSessionId: r.native_session_id,
    remoteUrl: r.remote_url,
    status: r.status as TaskStatus,
    pendingApprovals: r.pending_approvals,
    turnCount: r.turn_count,
    lastEventSeq: r.last_event_seq,
    lastError: json<AgentError>(r.last_error),
    readOnlyViolation: r.read_only_violation === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    archivedAt: r.archived_at,
    worktreeRemovedAt: r.worktree_removed_at,
  };
}

export function turnToDto(r: TurnRow): TurnDto {
  return {
    id: r.id,
    taskId: r.task_id,
    index: r.idx,
    prompt: r.prompt,
    model: r.model,
    reasoningEffort: r.reasoning_effort,
    status: r.status as TurnStatus,
    stopReason: r.stop_reason as StopReason | null,
    error: json<AgentError>(r.error),
    nativeTurnId: r.native_turn_id,
    turnStats: json<DiffStats>(r.turn_stats),
    taskStats: json<DiffStats>(r.task_stats),
    patchTruncated: r.patch_truncated === 1,
    usage: json<UsageInfo>(r.usage),
    finalMessage: r.final_message,
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

export function approvalToDto(r: ApprovalRow): ApprovalDto {
  const req = JSON.parse(r.request) as {
    command?: string;
    cwd?: string;
    paths?: string[];
    reason?: string;
    detail?: JsonValue;
  };
  return {
    id: r.id,
    taskId: r.task_id,
    turnId: r.turn_id,
    kind: r.kind as ApprovalKind,
    title: r.title,
    command: req.command ?? null,
    cwd: req.cwd ?? null,
    paths: req.paths ?? null,
    reason: req.reason ?? null,
    detail: req.detail ?? null,
    options: JSON.parse(r.options) as ApprovalDecision[],
    status: r.status as ApprovalStatus,
    decision: r.decision as ApprovalDecision | null,
    decidedBy: r.decided_by as DecidedBy | null,
    decidedByTokenId: r.decided_by_token_id,
    note: r.note,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    resolvedAt: r.resolved_at,
  };
}

export type Patch = Record<string, SqlValue | undefined>;

export class TasksRepo {
  constructor(private readonly db: Db) {}

  insertTask(row: TaskRow): void {
    const cols = Object.keys(row);
    this.db.run(
      `INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
      row as unknown as Record<string, SqlValue>,
    );
  }

  insertTurn(row: TurnRow): void {
    const cols = Object.keys(row);
    this.db.run(
      `INSERT INTO turns (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
      row as unknown as Record<string, SqlValue>,
    );
  }

  insertApproval(row: ApprovalRow): void {
    const cols = Object.keys(row);
    this.db.run(
      `INSERT INTO approvals (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
      row as unknown as Record<string, SqlValue>,
    );
  }

  task(idOrShort: string): TaskRow | undefined {
    return this.db.get<TaskRow>(`SELECT * FROM tasks WHERE id = :v OR short_id = :v`, {
      v: idOrShort,
    });
  }

  updateTask(id: string, patch: Patch): void {
    updateById((sql, p) => this.db.run(sql, p), 'tasks', id, {
      ...patch,
      updated_at: new Date().toISOString(),
    });
  }

  updateTurn(id: string, patch: Patch): void {
    updateById((sql, p) => this.db.run(sql, p), 'turns', id, patch);
  }

  turns(taskId: string): TurnRow[] {
    return this.db.all<TurnRow>(`SELECT * FROM turns WHERE task_id = :t ORDER BY idx ASC`, {
      t: taskId,
    });
  }

  turn(id: string): TurnRow | undefined {
    return this.db.get<TurnRow>(`SELECT * FROM turns WHERE id = :id`, { id });
  }

  latestTurn(taskId: string): TurnRow | undefined {
    return this.db.get<TurnRow>(
      `SELECT * FROM turns WHERE task_id = :t ORDER BY idx DESC LIMIT 1`,
      { t: taskId },
    );
  }

  pendingTurn(taskId: string): TurnRow | undefined {
    return this.db.get<TurnRow>(
      `SELECT * FROM turns WHERE task_id = :t AND status = 'pending' ORDER BY idx DESC LIMIT 1`,
      { t: taskId },
    );
  }

  queued(): TaskRow[] {
    return this.db.all<TaskRow>(
      `SELECT t.* FROM tasks t JOIN turns u ON u.task_id = t.id AND u.status = 'pending'
       WHERE t.status = 'queued' ORDER BY u.created_at ASC, t.id ASC`,
    );
  }

  countByStatus(statuses: TaskStatus[], agentId?: string): number {
    const list = statuses.map((s) => `'${s}'`).join(',');
    const row = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tasks WHERE status IN (${list})${agentId ? ' AND agent_id = :a' : ''}`,
      agentId ? { a: agentId } : {},
    );
    return row?.n ?? 0;
  }

  list(q: {
    statuses?: TaskStatus[];
    agentId?: string;
    repoId?: string;
    source?: string;
    externalRef?: string;
    archived: boolean;
    q?: string;
    sourceTokenId?: string;
    limit: number;
    cursor?: { createdAt: string; id: string };
  }): TaskRow[] {
    const where: string[] = [q.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
    const params: Record<string, SqlValue> = { limit: q.limit + 1 };
    if (q.statuses?.length) {
      where.push(`status IN (${q.statuses.map((_, i) => `:s${i}`).join(',')})`);
      q.statuses.forEach((s, i) => (params[`s${i}`] = s));
    }
    if (q.agentId) {
      where.push('agent_id = :agent');
      params.agent = q.agentId;
    }
    if (q.repoId) {
      where.push('repo_id = :repo');
      params.repo = q.repoId;
    }
    if (q.source) {
      where.push('source = :source');
      params.source = q.source;
    }
    if (q.externalRef) {
      where.push('external_ref = :ext');
      params.ext = q.externalRef;
    }
    if (q.sourceTokenId) {
      where.push('source_token_id = :tok');
      params.tok = q.sourceTokenId;
    }
    if (q.q) {
      where.push("title LIKE :q ESCAPE '\\'");
      params.q = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    }
    if (q.cursor) {
      where.push('(created_at < :cc OR (created_at = :cc AND id < :ci))');
      params.cc = q.cursor.createdAt;
      params.ci = q.cursor.id;
    }
    return this.db.all<TaskRow>(
      `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT :limit`,
      params,
    );
  }

  approvals(q: { status?: string; taskId?: string; limit: number }): ApprovalRow[] {
    const where: string[] = ['1 = 1'];
    const params: Record<string, SqlValue> = { limit: q.limit };
    if (q.status) {
      where.push('status = :status');
      params.status = q.status;
    }
    if (q.taskId) {
      where.push('task_id = :task');
      params.task = q.taskId;
    }
    return this.db.all<ApprovalRow>(
      `SELECT * FROM approvals WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT :limit`,
      params,
    );
  }

  approval(id: string): ApprovalRow | undefined {
    return this.db.get<ApprovalRow>(`SELECT * FROM approvals WHERE id = :id`, { id });
  }

  updateApproval(id: string, patch: Patch): void {
    const sets = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!sets.length) return;
    this.db.run(
      `UPDATE approvals SET ${sets.map(([k]) => `${k} = :${k}`).join(', ')} WHERE id = :id`,
      { id, ...(Object.fromEntries(sets) as Record<string, SqlValue>) },
    );
  }

  adjustPendingApprovals(taskId: string, delta: number): void {
    this.db.run(
      `UPDATE tasks SET pending_approvals = MAX(0, pending_approvals + :d), updated_at = :ts WHERE id = :id`,
      { d: delta, ts: new Date().toISOString(), id: taskId },
    );
  }
}
