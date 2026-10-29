import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { CollectionRouter } from './collection.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [CollectionRouter],
  exports: [CollectionRouter],
})
export class CollectionModule {}
