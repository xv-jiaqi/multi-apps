import { Module } from '@nestjs/common';
import { SeriesRouter } from './series.router';
import { TrpcBaseModule } from '../../trpc/trpc-base.module';

@Module({
  imports: [TrpcBaseModule],
  providers: [SeriesRouter],
  exports: [SeriesRouter],
})
export class SeriesModule {}
