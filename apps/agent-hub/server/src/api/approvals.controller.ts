import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  decisionBodySchema,
  listApprovalsQuerySchema,
  type ApprovalDto,
  type ItemsResponse,
} from '@agent-hub/contract';
import type { Request } from 'express';
import { assertOwns, getPrincipal } from '../auth/principal';
import { ApprovalService } from '../core/approval.service';
import { TaskService } from '../core/task.service';
import { approvalToDto } from '../db/repositories/tasks.repo';
import { Scopes } from './access';
import { ApiError, parseInput } from './api-error';

@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly tasks: TaskService,
  ) {}

  @Get()
  @Scopes('tasks:read')
  list(@Query() query: unknown): ItemsResponse<ApprovalDto> {
    const q = parseInput(listApprovalsQuerySchema, query);
    return { items: this.tasks.repo.approvals(q).map(approvalToDto) };
  }

  @Post(':approvalId/decision')
  @HttpCode(200)
  @Scopes('approvals:decide')
  decide(@Param('approvalId') id: string, @Req() req: Request, @Body() body: unknown): ApprovalDto {
    const input = parseInput(decisionBodySchema, body);
    const principal = getPrincipal(req);
    const row = this.tasks.repo.approval(id);
    if (!row) throw new ApiError('APPROVAL_NOT_FOUND', '审批不存在');
    const task = this.tasks.load(row.task_id);
    assertOwns(principal, { sourceTokenId: task.source_token_id });
    const dto = this.approvals.decide(
      id,
      input.decision,
      principal.kind,
      principal.tokenId,
      input.note ?? null,
    );
    if (input.decision === 'cancel_turn') void this.tasks.cancel(principal, task.id, false);
    return dto;
  }
}
