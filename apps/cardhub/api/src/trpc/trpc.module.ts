import { Module } from '@nestjs/common';
import { TrpcBaseModule } from './trpc-base.module';
import { TrpcService } from './trpc.service';
import { HealthModule } from '../modules/health/health.module';
import { SeriesModule } from '../modules/series/series.module';
import { CardsModule } from '../modules/cards/cards.module';
import { AuthModule } from '../modules/auth/auth.module';
import { CommentsModule } from '../modules/comments/comments.module';
import { ForumModule } from '../modules/forum/forum.module';
import { ListingsModule } from '../modules/listings/listings.module';
import { ReportsModule } from '../modules/reports/reports.module';
import { UsersModule } from '../modules/users/users.module';

@Module({
  imports: [
    TrpcBaseModule,
    HealthModule,
    SeriesModule,
    CardsModule,
    AuthModule,
    CommentsModule,
    ForumModule,
    ListingsModule,
    ReportsModule,
    UsersModule,
  ],
  providers: [TrpcService],
  exports: [TrpcService],
})
export class TrpcModule {}
