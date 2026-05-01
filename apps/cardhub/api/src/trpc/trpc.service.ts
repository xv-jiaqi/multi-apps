import { Injectable } from '@nestjs/common';
import { TrpcBase } from './trpc-base';
import { HealthRouter } from '../modules/health/health.router';
import { SeriesRouter } from '../modules/series/series.router';
import { CardsRouter } from '../modules/cards/cards.router';

@Injectable()
export class TrpcService {
  readonly appRouter;

  constructor(
    private readonly t: TrpcBase,
    private readonly health: HealthRouter,
    private readonly series: SeriesRouter,
    private readonly cards: CardsRouter,
  ) {
    this.appRouter = this.t.router({
      health: this.health.build(),
      series: this.series.build(),
      cards: this.cards.build(),
    });
  }
}

export type AppRouter = TrpcService['appRouter'];
