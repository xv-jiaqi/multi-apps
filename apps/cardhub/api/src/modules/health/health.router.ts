import { Injectable } from '@nestjs/common';
import { TrpcBase } from '../../trpc/trpc-base';
import { HealthService } from './health.service';

@Injectable()
export class HealthRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly health: HealthService,
  ) {}

  build() {
    return this.t.router({
      ping: this.t.procedure.query(() => ({
        status: 'ok' as const,
        timestamp: Date.now(),
        message: '欢迎来到 Cardhub',
        ...this.health.metadata(),
      })),
    });
  }
}
