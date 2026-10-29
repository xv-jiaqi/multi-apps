import { Module } from '@nestjs/common';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';
import { CategoriesRouter } from './categories.router';

@Module({
  imports: [TrpcBaseModule],
  providers: [CategoriesRouter],
  exports: [CategoriesRouter],
})
export class CategoriesModule {}
