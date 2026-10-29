import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import {
  APP_ERROR_CODES,
  collectionByCardInput,
  collectionListInput,
  collectionUpsertInput,
} from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { decodeCollectionCursor, encodeCollectionCursor } from './collection-cursor';
import { retryUniqueConflict } from './collection-write';

type CollectionCardRef = {
  slug: string;
  name: string;
  imageUrl: string | null;
  series: { slug: string; title: string };
};

type CollectionRow = {
  id: string;
  ownedCount: number;
  wanted: boolean;
  createdAt: Date;
  updatedAt: Date;
  card: CollectionCardRef;
};

type CollectionEntryBase = {
  id: string;
  cardSlug: string;
  cardName: string;
  imageUrl: string | null;
  seriesSlug: string;
  seriesTitle: string;
  createdAt: string;
  updatedAt: string;
};

type OwnedCollectionEntry = CollectionEntryBase & {
  state: 'owned';
  ownedCount: number;
  wanted: boolean;
};

type WantedCollectionEntry = CollectionEntryBase & {
  state: 'wanted';
  ownedCount: 0;
  wanted: true;
};

type CollectionEntry = OwnedCollectionEntry | WantedCollectionEntry;

type CollectionUpsertResult =
  | { outcome: 'saved'; item: CollectionEntry }
  | { outcome: 'removed'; cardSlug: string };

type SeriesProgress = {
  seriesSlug: string;
  seriesTitle: string;
  owned: number;
  total: number;
};

type ProgressSource = {
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  ownedCount: number;
};

function cardNotFound(): TRPCError {
  return new TRPCError({
    code: 'NOT_FOUND',
    message: '卡牌不存在',
    cause: { appCode: APP_ERROR_CODES.NOT_FOUND },
  });
}

function entryBase(row: CollectionRow): CollectionEntryBase {
  return {
    id: row.id,
    cardSlug: row.card.slug,
    cardName: row.card.name,
    imageUrl: row.card.imageUrl,
    seriesSlug: row.card.series.slug,
    seriesTitle: row.card.series.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEntry(row: CollectionRow): CollectionEntry {
  const base = entryBase(row);
  if (row.ownedCount > 0) {
    const owned: OwnedCollectionEntry = {
      ...base,
      state: 'owned',
      ownedCount: row.ownedCount,
      wanted: row.wanted,
    };
    return owned;
  }
  if (row.wanted) {
    const wanted: WantedCollectionEntry = {
      ...base,
      state: 'wanted',
      ownedCount: 0,
      wanted: true,
    };
    return wanted;
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '收藏记录无效' });
}

function savedResult(item: CollectionEntry): CollectionUpsertResult {
  const result: CollectionUpsertResult = { outcome: 'saved', item };
  return result;
}

function removedResult(cardSlug: string): CollectionUpsertResult {
  const result: CollectionUpsertResult = { outcome: 'removed', cardSlug };
  return result;
}

const collectionCardSelect = {
  slug: true,
  name: true,
  imageUrl: true,
  series: { select: { slug: true, title: true } },
} as const;

type ListState = 'all' | 'owned' | 'wanted';

function visibilityWhere(state: ListState) {
  if (state === 'owned') return { ownedCount: { gt: 0 } };
  if (state === 'wanted') return { wanted: true };
  return { OR: [{ ownedCount: { gt: 0 } }, { wanted: true }] };
}

function keysetWhere(point: { updatedAt: Date; id: string }) {
  return {
    OR: [
      { updatedAt: { lt: point.updatedAt } },
      { AND: [{ updatedAt: point.updatedAt }, { id: { lt: point.id } }] },
    ],
  };
}

/**
 * A keyset cursor already carries the boundary. An older cursor is the row id:
 * use that row's updatedAt while it still exists. A deleted id has no
 * boundary, so the page is empty instead of a 500 from Prisma's cursor lookup.
 */
async function readListCursor(
  prisma: PrismaService,
  userId: string,
  cursor: string | undefined,
): Promise<{ updatedAt: Date; id: string } | 'missing' | null> {
  if (!cursor) return null;
  const decoded = decodeCollectionCursor(cursor);
  if (decoded) return decoded;
  const row = await prisma.collectionItem.findFirst({
    where: { id: cursor, userId },
    select: { id: true, updatedAt: true },
  });
  if (!row) return 'missing';
  return row;
}

function progressItems(input: {
  rows: ProgressSource[];
  totals: ReadonlyMap<string, number>;
}): SeriesProgress[] {
  const buckets = new Map<string, { seriesSlug: string; seriesTitle: string; owned: number }>();
  for (const row of input.rows) {
    const current = buckets.get(row.seriesId) ?? {
      seriesSlug: row.seriesSlug,
      seriesTitle: row.seriesTitle,
      owned: 0,
    };
    if (row.ownedCount > 0) current.owned += 1;
    buckets.set(row.seriesId, current);
  }

  const items: SeriesProgress[] = [];
  for (const [seriesId, bucket] of buckets) {
    items.push({
      seriesSlug: bucket.seriesSlug,
      seriesTitle: bucket.seriesTitle,
      owned: bucket.owned,
      total: input.totals.get(seriesId) ?? 0,
    });
  }
  items.sort((left, right) => {
    const byTitle = left.seriesTitle.localeCompare(right.seriesTitle, 'zh-CN');
    if (byTitle !== 0) return byTitle;
    return left.seriesSlug.localeCompare(right.seriesSlug);
  });
  return items;
}

@Injectable()
export class CollectionRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;

    return t.router({
      // Private inventory, not a public post. A banned account can still
      // record what it owns. CH-213 has not landed, so progress counts every
      // card in the series and there is no includeParallels input.
      upsert: t.authedProcedure.input(collectionUpsertInput).mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const userId = ctx.user.sub;
        const card = await prisma.card.findUnique({
          where: { slug: input.cardSlug },
          select: {
            id: true,
            slug: true,
            name: true,
            series: { select: { slug: true, title: true } },
          },
        });
        if (!card) throw cardNotFound();

        if (input.ownedCount === 0 && !input.wanted) {
          await prisma.collectionItem.deleteMany({ where: { userId, cardId: card.id } });
          return removedResult(card.slug);
        }

        const saved = await retryUniqueConflict(() =>
          prisma.collectionItem.upsert({
            where: { userId_cardId: { userId, cardId: card.id } },
            create: {
              userId,
              cardId: card.id,
              ownedCount: input.ownedCount,
              wanted: input.wanted,
            },
            update: {
              ownedCount: input.ownedCount,
              wanted: input.wanted,
            },
            include: { card: { select: collectionCardSelect } },
          }),
        );
        return savedResult(toEntry(saved));
      }),

      byCard: t.authedProcedure.input(collectionByCardInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const row = await prisma.collectionItem.findFirst({
          where: { userId: ctx.user.sub, card: { slug: input.cardSlug } },
          select: { ownedCount: true, wanted: true },
        });
        if (!row) return null;
        return { ownedCount: row.ownedCount, wanted: row.wanted };
      }),

      list: t.authedProcedure.input(collectionListInput).query(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const userId = ctx.user.sub;
        const point = await readListCursor(prisma, userId, input.cursor);
        if (point === 'missing') return { items: [], nextCursor: null };
        const items = await prisma.collectionItem.findMany({
          where: {
            userId,
            AND: [visibilityWhere(input.state), ...(point ? [keysetWhere(point)] : [])],
          },
          take: input.limit + 1,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          include: { card: { select: collectionCardSelect } },
        });
        const hasMore = items.length > input.limit;
        const sliced = hasMore ? items.slice(0, input.limit) : items;
        const last = sliced[sliced.length - 1];
        return {
          items: sliced.map((row) => toEntry(row)),
          nextCursor: hasMore && last ? encodeCollectionCursor(last.updatedAt, last.id) : null,
        };
      }),

      // Want-only rows stay in the list. Spec v1.2 §3 shows them as owned 0 / total N.
      progress: t.authedProcedure.query(async ({ ctx }) => {
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const stored = await prisma.collectionItem.findMany({
          where: { userId: ctx.user.sub },
          select: {
            ownedCount: true,
            card: {
              select: {
                seriesId: true,
                series: { select: { slug: true, title: true } },
              },
            },
          },
        });
        const rows: ProgressSource[] = stored.map((row) => ({
          seriesId: row.card.seriesId,
          seriesSlug: row.card.series.slug,
          seriesTitle: row.card.series.title,
          ownedCount: row.ownedCount,
        }));
        const seriesIds = [...new Set(rows.map((row) => row.seriesId))];
        const totals = new Map<string, number>();
        if (seriesIds.length > 0) {
          const counts = await prisma.card.groupBy({
            by: ['seriesId'],
            where: { seriesId: { in: seriesIds } },
            _count: { _all: true },
          });
          for (const count of counts) {
            totals.set(count.seriesId, count._count._all);
          }
        }
        return { items: progressItems({ rows, totals }) };
      }),
    });
  }
}
