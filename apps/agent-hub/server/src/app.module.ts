import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessGuard } from './api/access';
import { BridgeRedactInterceptor } from './api/bridge-output';
import { ApiErrorFilter } from './api/error.filter';
import { HealthController } from './api/health.controller';
import { MeController } from './api/me.controller';
import { SettingsController } from './api/settings.controller';
import { TokensController } from './api/tokens.controller';
import { WsHub } from './api/ws-hub';
import { AgentsController } from './api/agents.controller';
import { ApprovalsController } from './api/approvals.controller';
import { ReposController } from './api/repos.controller';
import { TasksController } from './api/tasks.controller';
import { NodeProcessSupervisor } from './adapters/process/supervisor';
import type { ProcessSupervisor } from './adapters/types';
import { AdapterRegistry } from './core/adapter-registry';
import { ApprovalService } from './core/approval.service';
import { EventBus } from './core/event-bus';
import { EventStore } from './core/event-store';
import { HubRuntime } from './core/hub-runtime';
import { Scheduler } from './core/scheduler';
import { TaskRunner } from './core/task-runner';
import { TaskService } from './core/task.service';
import { createProcessTable } from './db/repositories/processes.repo';
import { GIT_GUARD, HUB_GIT, PROCESS_SUPERVISOR } from './common/tokens';
import { createGit, type Git } from './workspace/git';
import { GitGuard } from './workspace/git-guard';
import { AuthService } from './auth/auth.service';
import type { HubLogger } from './common/logger';
import { HUB_PATHS, type HubPaths } from './common/paths';
import { HubConfigService } from './config/config.service';
import type { Db } from './db/sqlite';
import { Lifecycle } from './lifecycle';

import { HUB_DB, HUB_LOGGER } from './common/tokens';

export { HUB_DB, HUB_LOGGER };

export interface AppModuleOptions {
  paths: HubPaths;
  db: Db;
  logger: HubLogger;
  config: HubConfigService;
  auth: AuthService;
  /** 测试可替换；默认用 process.env 构造。 */
  git?: Git;
  supervisor?: ProcessSupervisor;
}

@Module({})
export class AppModule {
  static register(opts: AppModuleOptions) {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        MeController,
        TokensController,
        SettingsController,
        AgentsController,
        ReposController,
        TasksController,
        ApprovalsController,
      ],
      providers: [
        Lifecycle,
        { provide: HUB_PATHS, useValue: opts.paths },
        { provide: HUB_DB, useValue: opts.db },
        { provide: HUB_LOGGER, useValue: opts.logger },
        { provide: HubConfigService, useValue: opts.config },
        { provide: AuthService, useValue: opts.auth },
        { provide: HUB_GIT, useValue: opts.git ?? createGit(process.env) },
        {
          provide: PROCESS_SUPERVISOR,
          useValue:
            opts.supervisor ??
            new NodeProcessSupervisor(createProcessTable(opts.db), {
              debug: (m, meta) => opts.logger.debug?.(m, { scope: 'supervisor', ...meta }),
              info: (m, meta) => opts.logger.info(m, { scope: 'supervisor', ...meta }),
              warn: (m, meta) => opts.logger.warn(m, { scope: 'supervisor', ...meta }),
              error: (m, meta) => opts.logger.errorMsg(m, { scope: 'supervisor', ...meta }),
            }),
        },
        { provide: GIT_GUARD, useValue: new GitGuard(opts.paths) },
        EventBus,
        EventStore,
        ApprovalService,
        AdapterRegistry,
        TaskRunner,
        Scheduler,
        TaskService,
        HubRuntime,
        WsHub,
        { provide: APP_GUARD, useClass: AccessGuard },
        // local-api.md §3.4：返回给桥接 token 的每个字符串都过 redact()。
        { provide: APP_INTERCEPTOR, useClass: BridgeRedactInterceptor },
        {
          provide: APP_FILTER,
          useFactory: (logger: HubLogger) =>
            new ApiErrorFilter({
              error: (msg, meta) => logger.errorMsg(msg, meta),
            }),
          inject: [HUB_LOGGER],
        },
      ],
      exports: [AuthService, HubConfigService, Lifecycle, WsHub, HUB_PATHS, HUB_DB, HUB_LOGGER],
    };
  }
}
