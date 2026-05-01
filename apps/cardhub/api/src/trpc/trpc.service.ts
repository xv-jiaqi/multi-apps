import { Injectable } from '@nestjs/common';
import { TrpcBase } from './trpc-base';
import { HealthRouter } from '../modules/health/health.router';

@Injectable()
export class TrpcService {
  readonly appRouter;

  constructor(
    private readonly t: TrpcBase,
    private readonly health: HealthRouter,
  ) {
    this.appRouter = this.t.router({
      health: this.health.build(),
    });
  }
}

export type AppRouter = TrpcService['appRouter'];
