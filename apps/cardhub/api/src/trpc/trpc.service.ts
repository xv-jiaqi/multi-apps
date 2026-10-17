import { Injectable } from '@nestjs/common';
import { TrpcBase } from './trpc-base';
import { HealthRouter } from '../modules/health/health.router';
import { SeriesRouter } from '../modules/series/series.router';
import { CardsRouter } from '../modules/cards/cards.router';
import { AuthRouter } from '../modules/auth/auth.router';
import { CommentsRouter } from '../modules/comments/comments.router';
import { ForumRouter } from '../modules/forum/forum.router';
import { ListingsRouter } from '../modules/listings/listings.router';
import { ReportsRouter } from '../modules/reports/reports.router';
import { UsersRouter } from '../modules/users/users.router';

@Injectable()
export class TrpcService {
  readonly appRouter;

  constructor(
    private readonly t: TrpcBase,
    private readonly health: HealthRouter,
    private readonly series: SeriesRouter,
    private readonly cards: CardsRouter,
    private readonly auth: AuthRouter,
    private readonly comments: CommentsRouter,
    private readonly forum: ForumRouter,
    private readonly listings: ListingsRouter,
    private readonly reports: ReportsRouter,
    private readonly users: UsersRouter,
  ) {
    this.appRouter = this.t.router({
      health: this.health.build(),
      series: this.series.build(),
      cards: this.cards.build(),
      auth: this.auth.build(),
      comments: this.comments.build(),
      forum: this.forum.build(),
      listings: this.listings.build(),
      reports: this.reports.build(),
      users: this.users.build(),
    });
  }
}

export type AppRouter = TrpcService['appRouter'];
