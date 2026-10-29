import { Injectable } from '@nestjs/common';
import { TrpcBase } from './trpc-base';
import { HealthRouter } from '../modules/health/health.router';
import { SeriesRouter } from '../modules/series/series.router';
import { CategoriesRouter } from '../modules/categories/categories.router';
import { CardsRouter } from '../modules/cards/cards.router';
import { AuthRouter } from '../modules/auth/auth.router';
import { CommentsRouter } from '../modules/comments/comments.router';
import { ForumRouter } from '../modules/forum/forum.router';
import { ListingsRouter } from '../modules/listings/listings.router';
import { ReportsRouter } from '../modules/reports/reports.router';
import { UsersRouter } from '../modules/users/users.router';
import { SearchRouter } from '../modules/search/search.router';
import { AdminRouter } from '../modules/admin/admin.router';

@Injectable()
export class TrpcService {
  readonly appRouter;

  constructor(
    private readonly t: TrpcBase,
    private readonly health: HealthRouter,
    private readonly series: SeriesRouter,
    private readonly categories: CategoriesRouter,
    private readonly cards: CardsRouter,
    private readonly auth: AuthRouter,
    private readonly comments: CommentsRouter,
    private readonly forum: ForumRouter,
    private readonly listings: ListingsRouter,
    private readonly reports: ReportsRouter,
    private readonly users: UsersRouter,
    private readonly search: SearchRouter,
    private readonly admin: AdminRouter,
  ) {
    this.appRouter = this.t.router({
      health: this.health.build(),
      series: this.series.build(),
      categories: this.categories.build(),
      cards: this.cards.build(),
      search: this.search.build(),
      auth: this.auth.build(),
      comments: this.comments.build(),
      forum: this.forum.build(),
      listings: this.listings.build(),
      reports: this.reports.build(),
      users: this.users.build(),
      admin: this.admin.build(),
    });
  }
}

export type AppRouter = TrpcService['appRouter'];
