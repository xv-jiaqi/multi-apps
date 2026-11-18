import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AccessGuard } from './api/access';
import { ApiErrorFilter } from './api/error.filter';
import { HealthController } from './api/health.controller';
import { MeController } from './api/me.controller';
import { SettingsController } from './api/settings.controller';
import { TokensController } from './api/tokens.controller';
import { WsHub } from './api/ws-hub';
import { AuthService } from './auth/auth.service';
import type { HubLogger } from './common/logger';
import { HUB_PATHS, type HubPaths } from './common/paths';
import { HubConfigService } from './config/config.service';
import type { Db } from './db/sqlite';
import { Lifecycle } from './lifecycle';

export const HUB_DB = Symbol('HUB_DB');
export const HUB_LOGGER = Symbol('HUB_LOGGER');

export interface AppModuleOptions {
  paths: HubPaths;
  db: Db;
  logger: HubLogger;
  config: HubConfigService;
  auth: AuthService;
}

@Module({})
export class AppModule {
  static register(opts: AppModuleOptions) {
    return {
      module: AppModule,
      controllers: [HealthController, MeController, TokensController, SettingsController],
      providers: [
        Lifecycle,
        { provide: HUB_PATHS, useValue: opts.paths },
        { provide: HUB_DB, useValue: opts.db },
        { provide: HUB_LOGGER, useValue: opts.logger },
        { provide: HubConfigService, useValue: opts.config },
        { provide: AuthService, useValue: opts.auth },
        WsHub,
        { provide: APP_GUARD, useClass: AccessGuard },
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
