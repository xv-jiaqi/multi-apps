import { Controller, Get, Param, Post } from '@nestjs/common';
import type { AgentDto, ItemsResponse } from '@agent-hub/contract';
import { AdapterRegistry } from '../core/adapter-registry';
import { TaskService } from '../core/task.service';
import { Scopes } from './access';
import { ApiError } from './api-error';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly tasks: TaskService,
  ) {}

  private dto(id: string): AgentDto {
    const dto = this.registry.dto(id, {
      running: this.tasks.repo.countByStatus(['preparing', 'running'], id),
      queued: this.tasks.repo.countByStatus(['queued'], id),
    });
    if (!dto) throw new ApiError('AGENT_NOT_FOUND', `Agent ${id} 不存在`);
    return dto;
  }

  @Get()
  @Scopes('tasks:read')
  list(): ItemsResponse<AgentDto> {
    return { items: this.registry.ids().map((id) => this.dto(id)) };
  }

  @Post(':agentId/refresh')
  async refresh(@Param('agentId') agentId: string): Promise<AgentDto> {
    if (!this.registry.get(agentId))
      throw new ApiError('AGENT_NOT_FOUND', `Agent ${agentId} 不存在`);
    await this.registry.probe(agentId);
    return this.dto(agentId);
  }
}
