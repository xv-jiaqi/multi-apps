import { Module } from '@nestjs/common';
import { TrpcBaseModule } from './trpc-base.module';
import { TrpcService } from './trpc.service';
import { HealthModule } from '../modules/health/health.module';

@Module({
  imports: [TrpcBaseModule, HealthModule],
  providers: [TrpcService],
  exports: [TrpcService],
})
export class TrpcModule {}
