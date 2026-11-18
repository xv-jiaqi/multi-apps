import { Module } from '@nestjs/common';
import { CommentsRouter } from './comments.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { ContentSecurityModule } from '../content-security/content-security.module';

@Module({
  imports: [TrpcBaseModule, ContentSecurityModule],
  providers: [CommentsRouter],
  exports: [CommentsRouter],
})
export class CommentsModule {}
