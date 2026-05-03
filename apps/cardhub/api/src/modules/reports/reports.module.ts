import { Module } from '@nestjs/common';
import { ReportsRouter } from './reports.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [TrpcBaseModule],
  providers: [ReportsRouter],
  exports: [ReportsRouter],
})
export class ReportsModule {}
