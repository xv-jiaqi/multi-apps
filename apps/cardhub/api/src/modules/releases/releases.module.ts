import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { ReleasesRouter } from './releases.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [ReleasesRouter],
  exports: [ReleasesRouter],
})
export class ReleasesModule {}
