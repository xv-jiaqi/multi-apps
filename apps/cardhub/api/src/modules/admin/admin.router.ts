import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import {
  type AdminCatalogErrorCode,
  RARITY_VALUES,
  adminCardDeleteInput,
  adminCardUpsertInput,
  adminCatalogImportInput,
  adminSeriesDeleteInput,
  adminSeriesUpsertInput,
  CATALOG_IMPORT_MAX_ROWS,
  catalogImportLimit,
  slugSchema,
  t as translate,
} from '@repo/shared';
import { z } from 'zod';
import { categoryIdForSlug, subsetIdForSlug } from '../catalog/catalog-links';
import {
  cardNumberForInput,
  formatReleaseDate,
  releaseDateForInput,
} from '../catalog/release-date';
import { normalizeDeleteReason, writeContentDelete } from '../audit/content-delete';
import { buildAdminTaxonomyRouter } from './admin-taxonomy';
import { buildAdminAuditRouter, buildAdminUsersRouter } from './governance.router';
import { buildAdminMetricsProcedure } from '../metrics/metrics.router';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogCache, DirectCatalogCache } from '../redis/catalog-cache';

type AttributeValue = string | number | boolean;
type Attributes = Record<string, AttributeValue>;
type ImportStatus = 'created' | 'updated' | 'unchanged' | 'error';
type ImportRowKind = 'series' | 'card';

export interface ImportRowSummary {
  row: number;
  type: ImportRowKind;
  slug: string | null;
  name: string | null;
  seriesSlug?: string | null;
}

export interface ImportRowError {
  path: string;
  code: AdminCatalogErrorCode;
}

export interface ImportRowResult {
  row: ImportRowSummary;
  status: ImportStatus;
  errors: ImportRowError[];
}

interface NormalizedSeries {
  row: ImportRowSummary;
  slug: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
}

interface NormalizedCard {
  row: ImportRowSummary;
  slug: string;
  name: string;
  description: string | null;
  rarity: (typeof RARITY_VALUES)[number];
  imageUrl: string | null;
  attributes: Attributes;
  seriesSlug: string;
}

interface NormalizedImport {
  series: NormalizedSeries[];
  cards: NormalizedCard[];
  results: ImportRowResult[];
}

const seriesAdminInclude = {
  _count: { select: { cards: true, comments: true, subsets: true } },
  cards: { select: { _count: { select: { comments: true } } } },
  category: { select: { slug: true, name: true } },
} as const;

const cardAdminInclude = {
  series: { select: { slug: true, title: true } },
  subset: { select: { slug: true, name: true } },
  _count: { select: { comments: true } },
} as const;

type SeriesListRow = Prisma.SeriesGetPayload<{
  include: typeof seriesAdminInclude;
}>;

type CardAdminRow = Prisma.CardGetPayload<{
  include: typeof cardAdminInclude;
}>;

function normalizeOptionalText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeImageUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relationSlug(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  return typeof value.slug === 'string' ? value.slug : undefined;
}

function cardSeriesSlugs(nextSlug: string, previousSlug: string | undefined): string[] {
  if (previousSlug && previousSlug !== nextSlug) return [nextSlug, previousSlug];
  return [nextSlug];
}

function isSlug(value: unknown): value is string {
  return typeof value === 'string' && slugSchema.safeParse(value).success;
}

function isImageUrl(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      (value.trim() === '' ||
        value.trim().startsWith('https://') ||
        value.trim().startsWith('gradient:')))
  );
}

function toAttributes(value: unknown): Attributes | null {
  if (value === undefined) return {};
  if (!isPlainObject(value)) return null;

  const attributes: Attributes = {};
  for (const [key, attrValue] of Object.entries(value)) {
    if (
      typeof attrValue !== 'string' &&
      typeof attrValue !== 'number' &&
      typeof attrValue !== 'boolean'
    ) {
      return null;
    }
    if (typeof attrValue === 'number' && !Number.isFinite(attrValue)) {
      return null;
    }
    attributes[key] = attrValue;
  }
  return attributes;
}

function stableJson(value: unknown): string {
  if (!isPlainObject(value)) return JSON.stringify(value);
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = value[key];
        return acc;
      }, {}),
  );
}

function normalizeDbAttributes(value: Prisma.JsonValue | null): Attributes {
  const attributes = toAttributes(value);
  return attributes ?? {};
}

function sameAttributes(left: Attributes, right: Attributes): boolean {
  return stableJson(left) === stableJson(right);
}

function formatCard(card: CardAdminRow) {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    description: card.description,
    imageUrl: card.imageUrl,
    rarity: card.rarity,
    attributes: normalizeDbAttributes(card.attributes),
    seriesSlug: card.series.slug,
    seriesTitle: card.series.title,
    cardNumber: card.cardNumber ?? null,
    subsetSlug: card.subset?.slug ?? null,
    subsetName: card.subset?.name ?? null,
    commentCount: card._count.comments,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

function seriesCommentCount(series: SeriesListRow): number {
  return (
    series._count.comments + series.cards.reduce((total, card) => total + card._count.comments, 0)
  );
}

function formatSeries(series: SeriesListRow) {
  return {
    id: series.id,
    slug: series.slug,
    title: series.title,
    description: series.description,
    coverUrl: series.coverUrl,
    cardCount: series._count.cards,
    commentCount: seriesCommentCount(series),
    subsetCount: series._count.subsets ?? 0,
    releaseDate: formatReleaseDate(series.releaseDate),
    category: series.category ? { slug: series.category.slug, name: series.category.name } : null,
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
  };
}

function addError(errors: ImportRowError[], path: string, code: AdminCatalogErrorCode) {
  errors.push({ path, code });
}

function normalizeImport(data: unknown): NormalizedImport {
  const results: ImportRowResult[] = [];
  const normalizedSeries: NormalizedSeries[] = [];
  const normalizedCards: NormalizedCard[] = [];
  const seenSeriesSlugs = new Set<string>();
  const seenCardSlugs = new Set<string>();

  if (!Array.isArray(data)) {
    results.push({
      row: { row: 0, type: 'series', slug: null, name: null },
      status: 'error',
      errors: [{ path: 'data', code: 'INVALID_TYPE' }],
    });
    return { series: [], cards: [], results };
  }

  data.forEach((rawSeries, seriesIndex) => {
    const seriesPath = `series[${seriesIndex}]`;
    const rowNumber = results.length + 1;
    const row: ImportRowSummary = {
      row: rowNumber,
      type: 'series',
      slug: isPlainObject(rawSeries) && typeof rawSeries.slug === 'string' ? rawSeries.slug : null,
      name:
        isPlainObject(rawSeries) && typeof rawSeries.title === 'string' ? rawSeries.title : null,
    };
    const errors: ImportRowError[] = [];

    if (!isPlainObject(rawSeries)) {
      addError(errors, seriesPath, 'INVALID_TYPE');
    }

    const slug = isPlainObject(rawSeries) ? rawSeries.slug : undefined;
    const title = isPlainObject(rawSeries) ? rawSeries.title : undefined;
    const description = isPlainObject(rawSeries) ? rawSeries.description : undefined;
    const coverUrl = isPlainObject(rawSeries) ? rawSeries.coverUrl : undefined;

    if (slug === undefined || slug === '') addError(errors, `${seriesPath}.slug`, 'REQUIRED');
    else if (!isSlug(slug)) addError(errors, `${seriesPath}.slug`, 'SLUG_FORMAT');
    else if (seenSeriesSlugs.has(slug))
      addError(errors, `${seriesPath}.slug`, 'SLUG_DUPLICATE_IN_FILE');

    if (typeof title !== 'string' || title.trim() === '') {
      addError(errors, `${seriesPath}.title`, 'REQUIRED');
    } else if (title.trim().length > 120) {
      addError(errors, `${seriesPath}.title`, 'TOO_LONG');
    }

    if (description !== undefined && typeof description !== 'string') {
      addError(errors, `${seriesPath}.description`, 'INVALID_TYPE');
    } else if (typeof description === 'string' && description.trim().length > 5000) {
      addError(errors, `${seriesPath}.description`, 'TOO_LONG');
    }

    if (!isImageUrl(coverUrl)) {
      addError(errors, `${seriesPath}.coverUrl`, 'IMAGE_URL');
    }

    if (errors.length === 0 && typeof slug === 'string' && typeof title === 'string') {
      seenSeriesSlugs.add(slug);
      normalizedSeries.push({
        row,
        slug,
        title: title.trim(),
        description: normalizeOptionalText(
          typeof description === 'string' ? description : undefined,
        ),
        coverUrl: normalizeImageUrl(typeof coverUrl === 'string' ? coverUrl : undefined),
      });
    }

    results.push({ row, status: errors.length > 0 ? 'error' : 'created', errors });

    const rawCards = isPlainObject(rawSeries) ? rawSeries.cards : undefined;
    if (rawCards === undefined) return;
    if (!Array.isArray(rawCards)) {
      results[results.length - 1]!.errors.push({
        path: `${seriesPath}.cards`,
        code: 'INVALID_TYPE',
      });
      results[results.length - 1]!.status = 'error';
      return;
    }

    rawCards.forEach((rawCard, cardIndex) => {
      const cardPath = `${seriesPath}.cards[${cardIndex}]`;
      const cardRowNumber = results.length + 1;
      const cardRow: ImportRowSummary = {
        row: cardRowNumber,
        type: 'card',
        slug: isPlainObject(rawCard) && typeof rawCard.slug === 'string' ? rawCard.slug : null,
        name: isPlainObject(rawCard) && typeof rawCard.name === 'string' ? rawCard.name : null,
        seriesSlug: typeof slug === 'string' ? slug : null,
      };
      const cardErrors: ImportRowError[] = [];

      if (!isPlainObject(rawCard)) {
        addError(cardErrors, cardPath, 'INVALID_TYPE');
      }

      const cardSlug = isPlainObject(rawCard) ? rawCard.slug : undefined;
      const name = isPlainObject(rawCard) ? rawCard.name : undefined;
      const cardDescription = isPlainObject(rawCard) ? rawCard.description : undefined;
      const rarity = isPlainObject(rawCard) ? rawCard.rarity : undefined;
      const imageUrl = isPlainObject(rawCard) ? rawCard.imageUrl : undefined;
      const attributes = isPlainObject(rawCard) ? rawCard.attributes : undefined;

      if (cardSlug === undefined || cardSlug === '')
        addError(cardErrors, `${cardPath}.slug`, 'REQUIRED');
      else if (!isSlug(cardSlug)) addError(cardErrors, `${cardPath}.slug`, 'SLUG_FORMAT');
      else if (seenCardSlugs.has(cardSlug)) {
        addError(cardErrors, `${cardPath}.slug`, 'SLUG_DUPLICATE_IN_FILE');
      }

      if (typeof name !== 'string' || name.trim() === '') {
        addError(cardErrors, `${cardPath}.name`, 'REQUIRED');
      } else if (name.trim().length > 120) {
        addError(cardErrors, `${cardPath}.name`, 'TOO_LONG');
      }

      if (cardDescription !== undefined && typeof cardDescription !== 'string') {
        addError(cardErrors, `${cardPath}.description`, 'INVALID_TYPE');
      } else if (typeof cardDescription === 'string' && cardDescription.trim().length > 5000) {
        addError(cardErrors, `${cardPath}.description`, 'TOO_LONG');
      }

      if (typeof rarity !== 'string' || !RARITY_VALUES.includes(rarity as never)) {
        addError(cardErrors, `${cardPath}.rarity`, 'INVALID_RARITY');
      }

      if (!isImageUrl(imageUrl)) {
        addError(cardErrors, `${cardPath}.imageUrl`, 'IMAGE_URL');
      }

      const normalizedAttributes = toAttributes(attributes);
      if (normalizedAttributes === null) {
        addError(cardErrors, `${cardPath}.attributes`, 'INVALID_TYPE');
      }

      if (cardErrors.length === 0 && typeof cardSlug === 'string' && typeof name === 'string') {
        seenCardSlugs.add(cardSlug);
        normalizedCards.push({
          row: cardRow,
          slug: cardSlug,
          name: name.trim(),
          description: normalizeOptionalText(
            typeof cardDescription === 'string' ? cardDescription : undefined,
          ),
          rarity: rarity as (typeof RARITY_VALUES)[number],
          imageUrl: normalizeImageUrl(typeof imageUrl === 'string' ? imageUrl : undefined),
          attributes: normalizedAttributes ?? {},
          seriesSlug: typeof slug === 'string' ? slug : '',
        });
      }

      results.push({
        row: cardRow,
        status: cardErrors.length > 0 ? 'error' : 'created',
        errors: cardErrors,
      });
    });
  });

  return { series: normalizedSeries, cards: normalizedCards, results };
}

function isPrismaUniqueError(error: unknown): boolean {
  return isPlainObject(error) && error.code === 'P2002';
}

function assertCatalogImportLimits(raw: unknown): void {
  const violation = catalogImportLimit(raw);
  if (!violation) return;
  if (violation.reason === 'tooManyRows') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: translate('zh-CN', 'admin.import.tooManyRows', {
        count: violation.count,
        max: CATALOG_IMPORT_MAX_ROWS,
      }),
    });
  }
  throw new TRPCError({
    code: 'PAYLOAD_TOO_LARGE',
    message: translate('zh-CN', 'admin.import.tooLarge'),
  });
}

@Injectable()
export class AdminRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCache = new DirectCatalogCache(),
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;
    const cache = this.cache;

    const listSeries = t.adminProcedure.query(async () => {
      const series = await prisma.series.findMany({
        orderBy: [{ title: 'asc' }, { slug: 'asc' }],
        include: seriesAdminInclude,
      });
      return { items: series.map(formatSeries) };
    });

    const previewImport = async (data: unknown): Promise<ImportRowResult[]> => {
      const normalized = normalizeImport(data);
      const results = normalized.results;

      const seriesSlugs = normalized.series.map((series) => series.slug);
      const cardSlugs = normalized.cards.map((card) => card.slug);
      const referencedSeriesSlugs = normalized.cards.map((card) => card.seriesSlug);

      const [existingSeries, referencedSeries, existingCards] = await Promise.all([
        seriesSlugs.length > 0
          ? prisma.series.findMany({ where: { slug: { in: seriesSlugs } } })
          : Promise.resolve([]),
        referencedSeriesSlugs.length > 0
          ? prisma.series.findMany({ where: { slug: { in: referencedSeriesSlugs } } })
          : Promise.resolve([]),
        cardSlugs.length > 0
          ? prisma.card.findMany({
              where: { slug: { in: cardSlugs } },
              include: { series: { select: { slug: true } } },
            })
          : Promise.resolve([]),
      ]);

      const existingSeriesBySlug = new Map(existingSeries.map((series) => [series.slug, series]));
      const existingCardBySlug = new Map(existingCards.map((card) => [card.slug, card]));
      const existingSeriesSlugs = new Set(referencedSeries.map((series) => series.slug));
      const fileSeriesSlugs = new Set(normalized.series.map((series) => series.slug));

      for (const series of normalized.series) {
        const result = results.find((item) => item.row.row === series.row.row);
        if (!result || result.status === 'error') continue;
        const existing = existingSeriesBySlug.get(series.slug);
        if (!existing) {
          result.status = 'created';
          continue;
        }
        result.status =
          existing.title === series.title &&
          (existing.description ?? null) === series.description &&
          (existing.coverUrl ?? null) === series.coverUrl
            ? 'unchanged'
            : 'updated';
      }

      for (const card of normalized.cards) {
        const result = results.find((item) => item.row.row === card.row.row);
        if (!result || result.status === 'error') continue;
        if (!fileSeriesSlugs.has(card.seriesSlug) && !existingSeriesSlugs.has(card.seriesSlug)) {
          result.status = 'error';
          result.errors.push({
            path: `${card.row.type}[${card.row.row}].seriesSlug`,
            code: 'SERIES_NOT_FOUND',
          });
          continue;
        }
        const existing = existingCardBySlug.get(card.slug);
        if (!existing) {
          result.status = 'created';
          continue;
        }
        const existingAttributes = normalizeDbAttributes(existing.attributes);
        result.status =
          existing.name === card.name &&
          (existing.description ?? null) === card.description &&
          existing.rarity === card.rarity &&
          (existing.imageUrl ?? null) === card.imageUrl &&
          existing.series.slug === card.seriesSlug &&
          sameAttributes(existingAttributes, card.attributes)
            ? 'unchanged'
            : 'updated';
      }

      return results;
    };

    const applyImport = async (data: unknown) => {
      const preview = await previewImport(data);
      if (preview.some((row) => row.status === 'error')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '导入数据校验失败',
          cause: { rows: preview },
        });
      }

      const normalized = normalizeImport(data);
      await prisma.$transaction(async (tx) => {
        const seriesIdBySlug = new Map<string, string>();
        for (const series of normalized.series) {
          const saved = await tx.series.upsert({
            where: { slug: series.slug },
            update: {
              title: series.title,
              description: series.description,
              coverUrl: series.coverUrl,
            },
            create: {
              slug: series.slug,
              title: series.title,
              description: series.description,
              coverUrl: series.coverUrl,
            },
            select: { id: true, slug: true },
          });
          seriesIdBySlug.set(saved.slug, saved.id);
        }

        const missingSeriesSlugs = Array.from(
          new Set(
            normalized.cards
              .map((card) => card.seriesSlug)
              .filter((seriesSlug) => !seriesIdBySlug.has(seriesSlug)),
          ),
        );
        if (missingSeriesSlugs.length > 0) {
          const existingSeries = await tx.series.findMany({
            where: { slug: { in: missingSeriesSlugs } },
            select: { id: true, slug: true },
          });
          for (const series of existingSeries) {
            seriesIdBySlug.set(series.slug, series.id);
          }
        }

        for (const card of normalized.cards) {
          const seriesId = seriesIdBySlug.get(card.seriesSlug);
          if (!seriesId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '系列不存在',
              cause: { code: 'SERIES_NOT_FOUND', slug: card.seriesSlug },
            });
          }
          const existing = await tx.card.findUnique({
            where: { slug: card.slug },
            select: { seriesId: true, subsetId: true },
          });
          const subsetId =
            existing && existing.seriesId !== seriesId && existing.subsetId ? null : undefined;
          await tx.card.upsert({
            where: { slug: card.slug },
            update: {
              name: card.name,
              description: card.description,
              rarity: card.rarity,
              imageUrl: card.imageUrl,
              attributes: card.attributes,
              seriesId,
              ...(subsetId !== undefined ? { subsetId } : {}),
            },
            create: {
              slug: card.slug,
              name: card.name,
              description: card.description,
              rarity: card.rarity,
              imageUrl: card.imageUrl,
              attributes: card.attributes,
              seriesId,
            },
          });
        }
      });

      return preview;
    };

    return t.router({
      series: t.router({
        list: listSeries,
        create: t.adminProcedure.input(adminSeriesUpsertInput).mutation(async ({ input }) => {
          const categoryId = await categoryIdForSlug(prisma, input.categorySlug);
          const releaseDate = releaseDateForInput(input.releaseDate);
          try {
            const series = await prisma.series.create({
              data: {
                slug: input.slug,
                title: input.title,
                description: normalizeOptionalText(input.description),
                coverUrl: normalizeImageUrl(input.coverUrl),
                ...(categoryId !== undefined ? { categoryId } : {}),
                ...(releaseDate !== undefined ? { releaseDate } : {}),
              },
              include: seriesAdminInclude,
            });
            await cache.invalidate({ kind: 'series', seriesSlug: series.slug });
            return formatSeries(series);
          } catch (error) {
            if (isPrismaUniqueError(error)) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'SLUG_TAKEN',
                cause: { code: 'SLUG_TAKEN' },
              });
            }
            throw error;
          }
        }),
        update: t.adminProcedure.input(adminSeriesUpsertInput).mutation(async ({ input }) => {
          const categoryId = await categoryIdForSlug(prisma, input.categorySlug);
          const releaseDate = releaseDateForInput(input.releaseDate);
          try {
            const series = await prisma.series.update({
              where: { slug: input.slug },
              data: {
                title: input.title,
                description: normalizeOptionalText(input.description),
                coverUrl: normalizeImageUrl(input.coverUrl),
                ...(categoryId !== undefined ? { categoryId } : {}),
                ...(releaseDate !== undefined ? { releaseDate } : {}),
              },
              include: seriesAdminInclude,
            });
            await cache.invalidate({ kind: 'series', seriesSlug: series.slug });
            return formatSeries(series);
          } catch (error) {
            if (isPlainObject(error) && error.code === 'P2025') {
              throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });
            }
            throw error;
          }
        }),
        delete: t.adminProcedure.input(adminSeriesDeleteInput).mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const actor = ctx.user;
          const series = await prisma.series.findUnique({
            where: { slug: input.slug },
            include: seriesAdminInclude,
          });
          if (!series) throw new TRPCError({ code: 'NOT_FOUND', message: '系列不存在' });

          const cardCount = series._count.cards;
          const commentCount = seriesCommentCount(series);
          if ((cardCount > 0 || commentCount > 0) && !input.force) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'SERIES_HAS_CARDS',
              cause: { code: 'SERIES_HAS_CARDS', cardCount, commentCount },
            });
          }

          await prisma.$transaction(async (tx) => {
            await tx.series.delete({ where: { slug: input.slug } });
            await writeContentDelete(tx, {
              actorId: actor.sub,
              actorUsername: actor.username,
              targetType: 'SERIES',
              targetId: series.id,
              targetLabel: series.title ?? '',
              targetUserId: null,
              reason: normalizeDeleteReason(input.reason),
            });
          });
          await cache.invalidate({ kind: 'series', seriesSlug: input.slug });
          return { ok: true, slug: input.slug, cardCount, commentCount };
        }),
      }),
      cards: t.router({
        get: t.adminProcedure.input(z.object({ slug: slugSchema })).query(async ({ input }) => {
          const card = await prisma.card.findUnique({
            where: { slug: input.slug },
            include: cardAdminInclude,
          });
          if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
          return formatCard(card);
        }),
        create: t.adminProcedure.input(adminCardUpsertInput).mutation(async ({ input }) => {
          const series = await prisma.series.findUnique({
            where: { slug: input.seriesSlug },
            select: { id: true },
          });
          if (!series) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'SERIES_NOT_FOUND',
              cause: { code: 'SERIES_NOT_FOUND' },
            });
          }
          const subsetId = await subsetIdForSlug(prisma, series.id, input.subsetSlug);
          const cardNumber = cardNumberForInput(input.cardNumber);
          try {
            const card = await prisma.card.create({
              data: {
                slug: input.slug,
                name: input.name,
                description: normalizeOptionalText(input.description),
                rarity: input.rarity,
                imageUrl: normalizeImageUrl(input.imageUrl),
                attributes: input.attributes,
                seriesId: series.id,
                ...(subsetId !== undefined ? { subsetId } : {}),
                ...(cardNumber !== undefined ? { cardNumber } : {}),
              },
              include: cardAdminInclude,
            });
            await cache.invalidate({
              kind: 'card',
              cardSlug: card.slug,
              seriesSlugs: [input.seriesSlug],
            });
            return formatCard(card);
          } catch (error) {
            if (isPrismaUniqueError(error)) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'SLUG_TAKEN',
                cause: { code: 'SLUG_TAKEN' },
              });
            }
            throw error;
          }
        }),
        update: t.adminProcedure.input(adminCardUpsertInput).mutation(async ({ input }) => {
          const series = await prisma.series.findUnique({
            where: { slug: input.seriesSlug },
            select: { id: true },
          });
          if (!series) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'SERIES_NOT_FOUND',
              cause: { code: 'SERIES_NOT_FOUND' },
            });
          }
          let subsetId = await subsetIdForSlug(prisma, series.id, input.subsetSlug);
          const existing = await prisma.card.findUnique({
            where: { slug: input.slug },
            select: { seriesId: true, subsetId: true, series: { select: { slug: true } } },
          });
          if (
            subsetId === undefined &&
            existing &&
            existing.seriesId !== series.id &&
            existing.subsetId
          ) {
            subsetId = null;
          }
          const previousSeriesSlug = relationSlug(existing?.series);
          const cardNumber = cardNumberForInput(input.cardNumber);
          try {
            const card = await prisma.card.update({
              where: { slug: input.slug },
              data: {
                name: input.name,
                description: normalizeOptionalText(input.description),
                rarity: input.rarity,
                imageUrl: normalizeImageUrl(input.imageUrl),
                attributes: input.attributes,
                seriesId: series.id,
                ...(subsetId !== undefined ? { subsetId } : {}),
                ...(cardNumber !== undefined ? { cardNumber } : {}),
              },
              include: cardAdminInclude,
            });
            await cache.invalidate({
              kind: 'card',
              cardSlug: card.slug,
              seriesSlugs: cardSeriesSlugs(input.seriesSlug, previousSeriesSlug),
            });
            return formatCard(card);
          } catch (error) {
            if (isPlainObject(error) && error.code === 'P2025') {
              throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
            }
            throw error;
          }
        }),
        delete: t.adminProcedure.input(adminCardDeleteInput).mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const actor = ctx.user;
          const card = await prisma.card.findUnique({
            where: { slug: input.slug },
            include: {
              _count: { select: { comments: true } },
              series: { select: { slug: true } },
            },
          });
          if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: '卡牌不存在' });
          await prisma.$transaction(async (tx) => {
            await tx.card.delete({ where: { slug: input.slug } });
            await writeContentDelete(tx, {
              actorId: actor.sub,
              actorUsername: actor.username,
              targetType: 'CARD',
              targetId: card.id,
              targetLabel: card.name ?? '',
              targetUserId: null,
              reason: normalizeDeleteReason(input.reason),
            });
          });
          const deletedSeriesSlug = relationSlug(card.series);
          await cache.invalidate({
            kind: 'card',
            cardSlug: input.slug,
            seriesSlugs: deletedSeriesSlug ? [deletedSeriesSlug] : [],
          });
          return { ok: true, slug: input.slug, commentCount: card._count.comments };
        }),
      }),
      catalog: t.router({
        import: t.adminProcedure
          .use(async ({ getRawInput, next }) => {
            // Reject the whole batch before zod and before any catalog read
            // or write. Row count and serialized size are decided on the raw
            // input so a 501-row or >1MB body never reaches the transaction.
            assertCatalogImportLimits(await getRawInput());
            return next();
          })
          .input(adminCatalogImportInput)
          .mutation(async ({ input }) => {
            if (input.dryRun) return previewImport(input.data);
            const applied = await applyImport(input.data);
            await cache.invalidate({ kind: 'catalog' });
            return applied;
          }),
      }),
      ...buildAdminTaxonomyRouter(t, prisma, cache),
      users: buildAdminUsersRouter(t, prisma),
      audit: buildAdminAuditRouter(t, prisma),
      metrics: buildAdminMetricsProcedure(t, prisma),
    });
  }
}
