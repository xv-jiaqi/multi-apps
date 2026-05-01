import { Module } from '@nestjs/common';
import { TrpcBaseModule } from './trpc-base.module';
import { TrpcService } from './trpc.service';
import { HealthModule } from '../modules/health/health.module';
import { SeriesModule } from '../modules/series/series.module';
import { CardsModule } from '../modules/cards/cards.module';

@Module({
  imports: [TrpcBaseModule, HealthModule, SeriesModule, CardsModule],
  providers: [TrpcService],
  exports: [TrpcService],
})
export class TrpcModule {}
