import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthRouter } from './health.router';
import { HealthService } from './health.service';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [TrpcBaseModule],
  controllers: [HealthController],
  providers: [HealthRouter, HealthService],
  exports: [HealthRouter],
})
export class HealthModule {}
