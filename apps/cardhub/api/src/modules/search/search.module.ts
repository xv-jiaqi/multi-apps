import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { SearchRouter } from './search.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [SearchRouter],
  exports: [SearchRouter],
})
export class SearchModule {}
