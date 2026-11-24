import { Inject, Injectable } from '@nestjs/common';
import {
  createTaskBodySchema,
  followUpBodySchema,
  isTerminalStatus,
  type AgentCapabilities,
  type ModelOption,
  type TaskDetailDto,
  type TaskDto,
  type TaskMode,
  type TaskResultDto,
  type TaskStatus,
  type TaskWithTurnResponse,
  type WorkspaceKind,
} from '@agent-hub/contract';
import { randomUUID } from 'node:crypto';
import { ApiError, parseInput } from '../api/api-error';
import { requestHash } from '../api/idempotency';
import { assertOwns, type Principal } from '../auth/principal';
import { HUB_DB, HUB_GIT } from '../common/tokens';
import { HubConfigService } from '../config/config.service';
import {
  approvalToDto,
  taskToDto,
  TasksRepo,
  turnToDto,
  type TaskRow,
  type TurnRow,
} from '../db/repositories/tasks.repo';
import type { Db } from '../db/sqlite';
import type { Git } from '../workspace/git';
import { expandHome, inspectRepo } from '../workspace/repo-inspector';
import { AdapterRegistry } from './adapter-registry';
import { EventBus } from './event-bus';
import { EventStore } from './event-store';
import { Scheduler } from './scheduler';
import { TaskRunner } from './task-runner';

function defaultTitle(prompt: string): string {
  const first = prompt.trim().split('\n')[0] ?? '';
  return [...first].slice(0, 40).join('') || '未命名任务';
}

@Injectable()
export class TaskService {
  readonly repo: TasksRepo;

  constructor(
    @Inject(HUB_DB) private readonly db: Db,
    @Inject(HUB_GIT) private readonly git: Git,
    private readonly config: HubConfigService,
    private readonly registry: AdapterRegistry,
    private readonly events: EventStore,
    private readonly bus: EventBus,
    private readonly scheduler: Scheduler,
    private readonly runner: TaskRunner,
  ) {
    this.repo = new TasksRepo(db);
  }

  load(id: string, principal?: Principal, own = false): TaskRow {
    const row = this.repo.task(id);
    if (!row) throw new ApiError('TASK_NOT_FOUND', '任务不存在');
    if (own && principal) assertOwns(principal, { sourceTokenId: row.source_token_id });
    return row;
  }

  async create(
    principal: Principal,
    raw: unknown,
    idemKey: string | null,
  ): Promise<{ status: number; body: TaskWithTurnResponse }> {
    const body = parseInput(createTaskBodySchema, raw, 'VALIDATION_FAILED');
    const replay = this.idemLookup(principal, idemKey, 'POST', '/tasks', raw);
    if (replay) return { status: 200, body: replay };
    const cfg = this.config.get();
    const agent = cfg.agents.find((a) => a.id === body.agentId);
    if (!agent) throw new ApiError('AGENT_NOT_FOUND', `Agent ${body.agentId} 不存在`);
    if (!agent.enabled) throw new ApiError('AGENT_DISABLED', `Agent ${body.agentId} 已禁用`);
    if (agent.kind === 'web')
      throw new ApiError('VALIDATION_FAILED', '本版本尚未接入网页 Agent', {
        issues: [{ path: 'agentId', message: '本版本尚未接入网页 Agent' }],
      });
    const repoId = body.repoId ?? cfg.defaultRepoId;
    if (!repoId)
      throw new ApiError('VALIDATION_FAILED', '没有指定仓库，也没有默认仓库', {
        issues: [{ path: 'repoId', message: '必填' }],
      });
    const repo = cfg.repos.find((r) => r.id === repoId);
    if (!repo) throw new ApiError('REPO_NOT_FOUND', `仓库 ${repoId} 不存在`);
    const repoPath = expandHome(repo.path);
    const inspection = await inspectRepo(this.git, repoPath);
    if (!inspection.ok)
      throw new ApiError('REPO_INVALID', `仓库不可用：${inspection.problems.join('；')}`, {
        problems: inspection.problems,
      });

    const mode: TaskMode = body.mode ?? 'read_only';
    const workspace: WorkspaceKind =
      body.workspace ?? (mode === 'read_only' ? 'in_place' : 'worktree');
    if (workspace === 'remote_branch') {
      throw new ApiError('VALIDATION_FAILED', '本地 Agent 不支持 remote_branch', {
        issues: [{ path: 'workspace', message: '只能是 in_place 或 worktree' }],
      });
    }
    if (principal.kind === 'bridge' && mode === 'write' && workspace === 'in_place') {
      throw new ApiError('BRIDGE_IN_PLACE_WRITE_FORBIDDEN', '桥接方的可写任务不能在原目录运行');
    }
    if (body.baseRef) {
      if (workspace === 'in_place')
        throw new ApiError('VALIDATION_FAILED', '原目录任务不能指定基线', {
          issues: [{ path: 'baseRef', message: '原目录任务不能指定基线' }],
        });
      const r = await this.git.exec(repoPath, [
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        `${body.baseRef}^{commit}`,
      ]);
      if (r.code !== 0)
        throw new ApiError('VALIDATION_FAILED', '基线不存在', {
          issues: [{ path: 'baseRef', message: '基线不存在' }],
        });
    }
    const defaults =
      agent.kind === 'codex' || agent.kind === 'acp'
        ? agent
        : { defaultModel: null, defaultReasoningEffort: null };
    const model = body.model ?? defaults.defaultModel ?? null;
    const effort = body.reasoningEffort ?? defaults.defaultReasoningEffort ?? null;
    this.validateModel(this.caps(body.agentId), model, effort, defaults.defaultModel ?? null);
    this.assertQueueRoom();

    const now = new Date().toISOString();
    const id = randomUUID();
    const taskRow: TaskRow = {
      id,
      short_id: id.slice(0, 8),
      title: body.title ?? defaultTitle(body.prompt),
      agent_id: agent.id,
      adapter_kind: agent.kind,
      repo_id: repo.id,
      repo_path: repoPath,
      source: principal.kind,
      source_token_id: principal.tokenId,
      external_ref: body.externalRef ?? null,
      mode,
      workspace_kind: workspace,
      workspace_path: workspace === 'in_place' ? repoPath : null,
      branch: null,
      base_ref: body.baseRef ?? null,
      base_commit: null,
      base_tree: null,
      model,
      reasoning_effort: effort,
      user_visible: body.userVisible ? 1 : 0,
      native_session_id: null,
      remote_url: null,
      status: 'queued',
      pending_approvals: 0,
      turn_count: 1,
      last_event_seq: 0,
      last_error: null,
      read_only_violation: 0,
      created_at: now,
      updated_at: now,
      started_at: null,
      ended_at: null,
      archived_at: null,
      worktree_removed_at: null,
    };
    const turnRow = this.newTurn(id, 1, body.prompt, model, effort, now);
    const result = this.db.tx(() => {
      const again = this.idemLookup(principal, idemKey, 'POST', '/tasks', raw);
      if (again) return again;
      this.repo.insertTask(taskRow);
      this.repo.insertTurn(turnRow);
      this.idemStore(principal, idemKey, 'POST', '/tasks', raw, id, turnRow.id, now);
      return null;
    });
    if (result) return { status: 200, body: result };
    const task = taskToDto(this.repo.task(id)!);
    this.bus.publishTask(task);
    this.scheduler.tick();
    return {
      status: 201,
      body: {
        task: taskToDto(this.repo.task(id)!),
        turn: turnToDto(this.repo.turn(turnRow.id)!),
        replayed: false,
      },
    };
  }

  followUp(
    principal: Principal,
    idOrShort: string,
    raw: unknown,
    idemKey: string | null,
  ): { status: number; body: TaskWithTurnResponse } {
    const body = parseInput(followUpBodySchema, raw, 'VALIDATION_FAILED');
    const task = this.load(idOrShort, principal, true);
    const route = `/tasks/${task.id}/turns`;
    const replay = this.idemLookup(principal, idemKey, 'POST', route, raw);
    if (replay) return { status: 200, body: replay };
    if (task.archived_at) throw new ApiError('TASK_ARCHIVED', '任务已归档');
    if (!isTerminalStatus(task.status as TaskStatus))
      throw new ApiError('TASK_BUSY', '任务还在进行中');
    if (task.worktree_removed_at)
      throw new ApiError('WORKSPACE_REMOVED', 'worktree 已被清理，不能追问');
    const cfg = this.config.get();
    const agent = cfg.agents.find((a) => a.id === task.agent_id);
    if (!agent) throw new ApiError('AGENT_NOT_FOUND', `Agent ${task.agent_id} 不存在`);
    if (!agent.enabled) throw new ApiError('AGENT_DISABLED', `Agent ${task.agent_id} 已禁用`);
    if (!cfg.repos.some((r) => r.id === task.repo_id))
      throw new ApiError('REPO_NOT_FOUND', `仓库 ${task.repo_id} 不存在`);
    const model = body.model === undefined ? task.model : body.model;
    const effort =
      body.reasoningEffort === undefined ? task.reasoning_effort : body.reasoningEffort;
    this.validateModel(
      this.caps(task.agent_id),
      model,
      effort,
      agent.kind === 'web' ? null : agent.defaultModel,
    );
    this.assertQueueRoom();
    const now = new Date().toISOString();
    const turnRow = this.newTurn(task.id, task.turn_count + 1, body.prompt, model, effort, now);
    const env = this.db.tx(() => {
      this.repo.insertTurn(turnRow);
      this.repo.updateTask(task.id, {
        status: 'queued',
        model,
        reasoning_effort: effort,
        turn_count: task.turn_count + 1,
        last_error: null,
        ended_at: null,
      });
      this.idemStore(principal, idemKey, 'POST', route, raw, task.id, turnRow.id, now);
      return this.events.persistInTx(task.id, null, {
        type: 'task.status',
        from: task.status as TaskStatus,
        to: 'queued',
      });
    });
    this.events.publish(env);
    this.bus.publishTask(taskToDto(this.repo.task(task.id)!));
    this.scheduler.tick();
    return {
      status: 201,
      body: {
        task: taskToDto(this.repo.task(task.id)!),
        turn: turnToDto(this.repo.turn(turnRow.id)!),
        replayed: false,
      },
    };
  }

  async cancel(principal: Principal, idOrShort: string, force: boolean): Promise<TaskDto> {
    const task = this.load(idOrShort, principal, true);
    const status = task.status as TaskStatus;
    if (isTerminalStatus(status)) return taskToDto(task);
    if (status === 'queued') {
      const turn = this.repo.pendingTurn(task.id);
      if (turn) {
        this.repo.updateTurn(turn.id, {
          status: 'cancelled',
          stop_reason: 'cancelled',
          ended_at: new Date().toISOString(),
        });
        this.events.append(task.id, turn.id, {
          type: 'turn.completed',
          turnId: turn.id,
          index: turn.idx,
          status: 'cancelled',
          stopReason: 'cancelled',
        });
      }
      this.runner.transition(task.id, 'queued', 'cancelled', turn?.id ?? null, {
        ended_at: new Date().toISOString(),
      });
      return taskToDto(this.repo.task(task.id)!);
    }
    void this.runner.cancel(task.id, force);
    return taskToDto(this.repo.task(task.id)!);
  }

  archive(principal: Principal, idOrShort: string, archived: boolean): TaskDto {
    const task = this.load(idOrShort, principal, true);
    if (archived) {
      if (!isTerminalStatus(task.status as TaskStatus))
        throw new ApiError('TASK_BUSY', '任务还在进行中');
      if (!task.archived_at)
        this.repo.updateTask(task.id, { archived_at: new Date().toISOString() });
    } else if (task.archived_at) {
      this.repo.updateTask(task.id, { archived_at: null });
    }
    const dto = taskToDto(this.repo.task(task.id)!);
    this.bus.publishTask(dto);
    return dto;
  }

  detail(row: TaskRow): TaskDetailDto {
    return {
      ...taskToDto(row),
      turns: this.repo.turns(row.id).map(turnToDto),
      approvals: this.repo.approvals({ taskId: row.id, limit: 1000 }).map(approvalToDto).reverse(),
    };
  }

  result(row: TaskRow): TaskResultDto {
    const turns = this.repo.turns(row.id);
    const last = turns[turns.length - 1]!;
    const withDiff = [...turns].reverse().find((t) => t.task_stats !== null);
    return {
      taskId: row.id,
      shortId: row.short_id,
      status: row.status as TaskStatus,
      turn: {
        index: last.idx,
        status: turnToDto(last).status,
        stopReason: turnToDto(last).stopReason,
        error: turnToDto(last).error,
        finalMessage: last.final_message,
        usage: turnToDto(last).usage,
      },
      diff: withDiff
        ? {
            turnIndex: withDiff.idx,
            stats: JSON.parse(withDiff.task_stats!),
            patchTruncated: withDiff.patch_truncated === 1,
          }
        : null,
      pendingApprovals: row.pending_approvals,
      readOnlyViolation: row.read_only_violation === 1,
      endedAt: row.ended_at,
    };
  }

  private caps(agentId: string): AgentCapabilities | null {
    return this.registry.dto(agentId, { running: 0, queued: 0 })?.capabilities ?? null;
  }

  private validateModel(
    caps: AgentCapabilities | null,
    model: string | null,
    effort: string | null,
    defaultModel: string | null,
  ): void {
    if (!caps) return;
    if (caps.modelsSource === 'none') {
      if (model || effort) throw new ApiError('MODEL_NOT_SUPPORTED', '这个 Agent 不能选模型');
      return;
    }
    if (caps.models.length === 0) return;
    if (model && !caps.models.some((m) => m.id === model))
      throw new ApiError('MODEL_NOT_SUPPORTED', `不支持的模型：${model}`);
    const effective: ModelOption | undefined =
      caps.models.find((m) => m.id === (model ?? defaultModel)) ??
      caps.models.find((m) => m.isDefault);
    if (effort && effective && !effective.reasoningEfforts.some((e) => e.id === effort)) {
      throw new ApiError('MODEL_NOT_SUPPORTED', `模型 ${effective.id} 不支持推理档位 ${effort}`);
    }
  }

  private assertQueueRoom(): void {
    if (this.repo.countByStatus(['queued']) >= this.config.get().scheduler.maxQueuedTasks) {
      throw new ApiError('QUEUE_FULL', '排队的任务太多，请稍后再试');
    }
  }

  private newTurn(
    taskId: string,
    idx: number,
    prompt: string,
    model: string | null,
    effort: string | null,
    now: string,
  ): TurnRow {
    return {
      id: randomUUID(),
      task_id: taskId,
      idx,
      prompt,
      model,
      reasoning_effort: effort,
      status: 'pending',
      stop_reason: null,
      error: null,
      native_turn_id: null,
      before_tree: null,
      after_tree: null,
      turn_patch: null,
      task_patch: null,
      turn_stats: null,
      task_stats: null,
      patch_truncated: 0,
      usage: null,
      final_message: null,
      created_at: now,
      started_at: null,
      ended_at: null,
    };
  }

  /** local-api §3.3：只对桥接 token 生效（UI token 没有 token id）。 */
  private idemLookup(
    principal: Principal,
    key: string | null,
    method: string,
    route: string,
    raw: unknown,
  ): TaskWithTurnResponse | null {
    if (!key || principal.kind !== 'bridge') return null;
    const row = this.db.get<{ request_hash: string; task_id: string; turn_id: string | null }>(
      `SELECT request_hash, task_id, turn_id FROM idempotency_keys WHERE token_id = :t AND key = :k`,
      { t: principal.tokenId, k: key },
    );
    if (!row) return null;
    if (row.request_hash !== requestHash(method, route, raw)) {
      throw new ApiError('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 对应了不同的请求');
    }
    const task = this.repo.task(row.task_id);
    const turn = row.turn_id ? this.repo.turn(row.turn_id) : undefined;
    if (!task || !turn) return null;
    return { task: taskToDto(task), turn: turnToDto(turn), replayed: true };
  }

  private idemStore(
    principal: Principal,
    key: string | null,
    method: string,
    route: string,
    raw: unknown,
    taskId: string,
    turnId: string,
    now: string,
  ): void {
    if (!key || principal.kind !== 'bridge') return;
    this.db.run(
      `INSERT INTO idempotency_keys (token_id, key, request_hash, task_id, turn_id, created_at)
       VALUES (:t, :k, :h, :task, :turn, :ts)`,
      {
        t: principal.tokenId,
        k: key,
        h: requestHash(method, route, raw),
        task: taskId,
        turn: turnId,
        ts: now,
      },
    );
  }
}
