import { Module } from '@nestjs/common';
import { ForumRouter } from './forum.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { ContentSecurityModule } from '../content-security/content-security.module';

@Module({
  imports: [TrpcBaseModule, ContentSecurityModule],
  providers: [ForumRouter],
  exports: [ForumRouter],
})
export class ForumModule {}
