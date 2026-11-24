import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { ContentSecurityCallbackController } from './content-security.callback.controller';
import { ContentSecurityRouter } from './content-security.router';
import { ContentSecurityService } from './content-security.service';

@Module({
  imports: [TrpcBaseModule],
  controllers: [ContentSecurityCallbackController],
  providers: [ContentSecurityService, ContentSecurityRouter],
  exports: [ContentSecurityService, ContentSecurityRouter],
})
export class ContentSecurityModule {}
