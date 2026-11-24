import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { UploadsRouter } from './uploads.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [UploadsRouter],
  exports: [UploadsRouter],
})
export class UploadsModule {}
