import { Module } from '@nestjs/common';
import { ForumRouter } from './forum.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [TrpcBaseModule],
  providers: [ForumRouter],
  exports: [ForumRouter],
})
export class ForumModule {}
