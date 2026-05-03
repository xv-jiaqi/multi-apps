import { Module } from '@nestjs/common';
import { ListingsRouter } from './listings.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [TrpcBaseModule],
  providers: [ListingsRouter],
  exports: [ListingsRouter],
})
export class ListingsModule {}
