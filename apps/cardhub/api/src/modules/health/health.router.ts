import { Injectable } from '@nestjs/common';
import { TrpcBase } from '../../trpc/trpc-base';

@Injectable()
export class HealthRouter {
  constructor(private readonly t: TrpcBase) {}

  build() {
    return this.t.router({
      ping: this.t.procedure.query(() => ({
        status: 'ok' as const,
        timestamp: Date.now(),
        message: '欢迎来到 Cardhub',
      })),
    });
  }
}
