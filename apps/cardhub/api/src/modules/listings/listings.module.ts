import { Module } from '@nestjs/common';
import { ListingsRouter } from './listings.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { ContentSecurityModule } from '../content-security/content-security.module';

@Module({
  imports: [TrpcBaseModule, ContentSecurityModule],
  providers: [ListingsRouter],
  exports: [ListingsRouter],
})
export class ListingsModule {}
