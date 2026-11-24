import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  inspectRepoBodySchema,
  type ItemsResponse,
  type RepoDto,
  type RepoInspectionDto,
} from '@agent-hub/contract';
import { HUB_GIT } from '../common/tokens';
import { HubConfigService } from '../config/config.service';
import type { Git } from '../workspace/git';
import { expandHome, inspectRepo } from '../workspace/repo-inspector';
import { Scopes } from './access';
import { ApiError, parseInput } from './api-error';

@Controller('repos')
export class ReposController {
  constructor(
    private readonly config: HubConfigService,
    @Inject(HUB_GIT) private readonly git: Git,
  ) {}

  @Get()
  @Scopes('tasks:read')
  async list(@Query('refresh') _refresh?: string): Promise<ItemsResponse<RepoDto>> {
    const cfg = this.config.get();
    const items = await Promise.all(
      cfg.repos.map(async (r) => ({
        id: r.id,
        name: r.name,
        path: expandHome(r.path),
        defaultBaseRef: r.defaultBaseRef,
        isDefault: cfg.defaultRepoId === r.id,
        inspection: await inspectRepo(this.git, r.path),
      })),
    );
    return { items };
  }

  @Get(':repoId/refs')
  @Scopes('tasks:read')
  async refs(@Param('repoId') repoId: string): Promise<ItemsResponse<string>> {
    const repo = this.config.get().repos.find((r) => r.id === repoId);
    if (!repo) throw new ApiError('REPO_NOT_FOUND', `仓库 ${repoId} 不存在`);
    const out = await this.git.run(expandHome(repo.path), [
      'for-each-ref',
      '--format=%(refname:short)',
      '--sort=-committerdate',
      '--count=200',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ]);
    return { items: out.split('\n').filter(Boolean) };
  }

  @Post('inspect')
  @HttpCode(200)
  inspect(@Body() body: unknown): Promise<RepoInspectionDto> {
    const input = parseInput(inspectRepoBodySchema, body);
    return inspectRepo(this.git, input.path);
  }
}
