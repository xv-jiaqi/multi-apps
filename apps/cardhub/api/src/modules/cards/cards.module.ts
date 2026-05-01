import { Module } from '@nestjs/common';
import { CardsRouter } from './cards.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [TrpcBaseModule],
  providers: [CardsRouter],
  exports: [CardsRouter],
})
export class CardsModule {}
