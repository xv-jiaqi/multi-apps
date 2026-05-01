import { Module } from '@nestjs/common';
import { TrpcBaseModule } from './trpc-base.module';
import { TrpcService } from './trpc.service';
import { HealthModule } from '../modules/health/health.module';
import { SeriesModule } from '../modules/series/series.module';
import { CardsModule } from '../modules/cards/cards.module';
import { AuthModule } from '../modules/auth/auth.module';
import { CommentsModule } from '../modules/comments/comments.module';

@Module({
  imports: [TrpcBaseModule, HealthModule, SeriesModule, CardsModule, AuthModule, CommentsModule],
  providers: [TrpcService],
  exports: [TrpcService],
})
export class TrpcModule {}
