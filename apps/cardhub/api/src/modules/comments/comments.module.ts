import { Module } from '@nestjs/common';
import { CommentsRouter } from './comments.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [TrpcBaseModule],
  providers: [CommentsRouter],
  exports: [CommentsRouter],
})
export class CommentsModule {}
