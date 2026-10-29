import { z } from 'zod';
import { CARD_SERIES_LIST_SORT_VALUES } from '@repo/shared';

const categoryRefSchema = z.object({ slug: z.string(), name: z.string() }).nullable();

const attributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const publicSeriesSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  cardCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  releaseDate: z.string().nullable(),
  category: categoryRefSchema,
});

export const seriesListSchema = z.object({
  items: z.array(publicSeriesSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  years: z.array(z.number()),
});

export const seriesBySlugSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  releaseDate: z.string().nullable(),
  category: categoryRefSchema,
  subsets: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      kind: z.enum(['BASE', 'INSERT']),
      sortOrder: z.number(),
    }),
  ),
  cards: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      rarity: z.string().nullable(),
      imageUrl: z.string().nullable(),
      cardNumber: z.string().nullable(),
      subsetSlug: z.string().nullable(),
    }),
  ),
});

const attributeLabelSchema = z.object({
  'zh-CN': z.string(),
  'en-US': z.string(),
});

export const cardsListBySeriesSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      rarity: z.string().nullable(),
      imageUrl: z.string().nullable(),
      cardNumber: z.string().nullable(),
      subsetSlug: z.string().nullable(),
      attributes: z.record(z.string(), attributeValueSchema).nullable(),
    }),
  ),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  sort: z.enum(CARD_SERIES_LIST_SORT_VALUES),
  attributeLabels: z.record(z.string(), attributeLabelSchema),
});

export const cardBySlugSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  rarity: z.string().nullable(),
  attributes: z.record(z.string(), attributeValueSchema).nullable(),
  seriesSlug: z.string(),
  seriesTitle: z.string(),
  cardNumber: z.string().nullable(),
  subset: z
    .object({
      slug: z.string(),
      name: z.string(),
      kind: z.enum(['BASE', 'INSERT']),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const categoriesListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      sortOrder: z.number(),
      seriesCount: z.number(),
    }),
  ),
});

export const categoryBySlugSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number(),
  series: z.array(publicSeriesSchema),
});
