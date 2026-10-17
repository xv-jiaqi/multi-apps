import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { AdminRouter } from './admin.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [AdminRouter],
  exports: [AdminRouter],
})
export class AdminModule {}
