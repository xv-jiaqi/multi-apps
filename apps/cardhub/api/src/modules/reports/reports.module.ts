import { Module } from '@nestjs/common';
import { ReportsRouter } from './reports.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { ContentSecurityModule } from '../content-security/content-security.module';

@Module({
  imports: [TrpcBaseModule, ContentSecurityModule],
  providers: [ReportsRouter],
  exports: [ReportsRouter],
})
export class ReportsModule {}
