import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  IDEMPOTENCY_KEY_PATTERN,
  TRUNCATED_HEADER,
  cancelBodySchema,
  diffQuerySchema,
  isTerminalStatus,
  listEventsQuerySchema,
  listTasksQuerySchema,
  waitQuerySchema,
  type DiffDto,
  type ListEventsResponse,
  type ListTasksResponse,
  type TaskDetailDto,
  type TaskDto,
  type TaskResultDto,
  type TaskStatus,
  type TaskWithTurnResponse,
  type WaitResponse,
} from '@agent-hub/contract';
import type { Request, Response } from 'express';
import { getPrincipal } from '../auth/principal';
import { EventBus } from '../core/event-bus';
import { EventStore } from '../core/event-store';
import { TaskRunner } from '../core/task-runner';
import { TaskService } from '../core/task.service';
import { taskToDto, type TaskRow } from '../db/repositories/tasks.repo';
import { Lifecycle } from '../lifecycle';
import { Scopes } from './access';
import { ApiError, parseInput } from './api-error';

function idemKey(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key 格式不对', {
      issues: [{ path: 'Idempotency-Key', message: '1–200 个字母、数字或 ._:-' }],
    });
  }
  return raw;
}

function encodeCursor(row: TaskRow): string {
  return Buffer.from(`${row.created_at}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): { createdAt: string; id: string } {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const i = text.indexOf('|');
  if (i <= 0)
    throw new ApiError('VALIDATION_FAILED', '游标无效', {
      issues: [{ path: 'cursor', message: '游标无效' }],
    });
  return { createdAt: text.slice(0, i), id: text.slice(i + 1) };
}

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TaskService,
    private readonly runner: TaskRunner,
    private readonly events: EventStore,
    private readonly bus: EventBus,
    private readonly lifecycle: Lifecycle,
  ) {}

  @Post()
  @Scopes('tasks:write')
  async create(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ): Promise<TaskWithTurnResponse> {
    const r = await this.tasks.create(getPrincipal(req), body, idemKey(key));
    res.status(r.status);
    return r.body;
  }

  @Get()
  @Scopes('tasks:read')
  list(@Query() query: unknown): ListTasksResponse {
    const q = parseInput(listTasksQuerySchema, query);
    const rows = this.tasks.repo.list({
      statuses: q.status,
      agentId: q.agentId,
      repoId: q.repoId,
      source: q.source,
      externalRef: q.externalRef,
      archived: q.archived,
      q: q.q,
      limit: q.limit,
      cursor: q.cursor ? decodeCursor(q.cursor) : undefined,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map(taskToDto),
      nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  @Get(':id')
  @Scopes('tasks:read')
  get(@Param('id') id: string): TaskDetailDto {
    return this.tasks.detail(this.tasks.load(id));
  }

  @Get(':id/events')
  @Scopes('tasks:read')
  listEvents(@Param('id') id: string, @Query() query: unknown): ListEventsResponse {
    const task = this.tasks.load(id);
    const q = parseInput(listEventsQuerySchema, query);
    this.events.flush(task.id);
    const page = this.events.list(task.id, q.afterSeq, q.limit + 1);
    const events = page.slice(0, q.limit);
    return {
      events,
      lastSeq: events.length ? events[events.length - 1]!.seq : q.afterSeq,
      hasMore: page.length > q.limit,
    };
  }

  @Get(':id/wait')
  @Scopes('tasks:read')
  async wait(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<WaitResponse> {
    const taskId = this.tasks.load(id).id;
    const q = parseInput(waitQuerySchema, query);
    const check = (): WaitResponse | null => {
      const row = this.tasks.repo.task(taskId)!;
      const terminal = isTerminalStatus(row.status as TaskStatus);
      const reached =
        q.until === 'turn_end'
          ? terminal
          : q.until === 'approval'
            ? row.pending_approvals > 0 || terminal
            : row.last_event_seq > q.afterSeq;
      return reached ? { reached: true, task: taskToDto(row), lastSeq: row.last_event_seq } : null;
    };
    return new Promise<WaitResponse>((resolve) => {
      const cleanups: Array<() => void> = [];
      const finish = (r: WaitResponse) => {
        for (const c of cleanups) c();
        resolve(r);
      };
      const notReached = () => {
        const row = this.tasks.repo.task(taskId)!;
        finish({ reached: false, task: taskToDto(row), lastSeq: row.last_event_seq });
      };
      const onChange = () => {
        const r = check();
        if (r) finish(r);
      };
      cleanups.push(this.bus.subscribeTaskEvents(taskId, onChange));
      const sub = this.bus.task$.subscribe((t) => t.id === taskId && onChange());
      cleanups.push(() => sub.unsubscribe());
      const timer = setTimeout(notReached, q.timeoutSec * 1000);
      cleanups.push(() => clearTimeout(timer));
      const onClose = () => notReached();
      req.on('close', onClose);
      cleanups.push(() => req.off('close', onClose));
      const first = check();
      if (first) finish(first);
    });
  }

  @Get(':id/result')
  @Scopes('tasks:read')
  result(@Param('id') id: string): TaskResultDto {
    return this.tasks.result(this.tasks.load(id));
  }

  @Get(':id/diff')
  @Scopes('tasks:read')
  async diff(
    @Param('id') id: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DiffDto | string> {
    const task = this.tasks.load(id);
    const q = parseInput(diffQuerySchema, query);
    let dto: DiffDto;
    if (q.live && task.status === 'running' && task.base_tree) {
      const turns = this.tasks.repo.turns(task.id);
      const live = await this.runner.liveDiff(task);
      dto = {
        taskId: task.id,
        scope: q.scope,
        turnIndex: turns[turns.length - 1]!.idx,
        live: true,
        stats: live.stats,
        patch: live.patch,
        truncated: live.truncated,
      };
    } else {
      const turns = this.tasks.repo.turns(task.id);
      let turn;
      if (q.turn !== undefined) {
        turn = turns.find((t) => t.idx === q.turn);
        if (!turn) throw new ApiError('TURN_NOT_FOUND', `第 ${q.turn} 轮不存在`);
        if (turn.task_stats === null) throw new ApiError('DIFF_NOT_AVAILABLE', '这一轮还没有 diff');
      } else {
        turn = [...turns].reverse().find((t) => t.task_stats !== null);
        if (!turn) throw new ApiError('DIFF_NOT_AVAILABLE', '还没有结束的轮，暂无 diff');
      }
      const isTask = q.scope === 'task';
      dto = {
        taskId: task.id,
        scope: q.scope,
        turnIndex: turn.idx,
        live: false,
        stats: JSON.parse((isTask ? turn.task_stats : turn.turn_stats)!),
        patch: isTask ? turn.task_patch : turn.turn_patch,
        truncated: turn.patch_truncated === 1,
      };
    }
    if (q.format === 'patch') {
      res.setHeader('Content-Type', 'text/x-diff; charset=utf-8');
      res.setHeader(TRUNCATED_HEADER, String(dto.truncated));
      return dto.patch ?? '';
    }
    return dto;
  }

  @Post(':id/turns')
  @Scopes('tasks:write')
  followUp(
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ): TaskWithTurnResponse {
    const r = this.tasks.followUp(getPrincipal(req), id, body, idemKey(key));
    res.status(r.status);
    return r.body;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Scopes('tasks:write')
  cancel(@Param('id') id: string, @Req() req: Request, @Body() body: unknown): Promise<TaskDto> {
    const input = parseInput(cancelBodySchema, body ?? {});
    return this.tasks.cancel(getPrincipal(req), id, input.force);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Scopes('tasks:write')
  archive(@Param('id') id: string, @Req() req: Request): TaskDto {
    return this.tasks.archive(getPrincipal(req), id, true);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @Scopes('tasks:write')
  unarchive(@Param('id') id: string, @Req() req: Request): TaskDto {
    return this.tasks.archive(getPrincipal(req), id, false);
  }
}
