import { describe, expect, it, vi } from 'vitest';
import {
  SERIES_DETAIL_CARD_LIST_PAGE_SIZE,
  collectSeriesDetailCardPages,
  remainingSeriesDetailCardListPages,
  seriesDetailCardListInput,
  seriesDetailCardListPageCount,
} from './series-detail-card-list';

describe('seriesDetailCardListInput', () => {
  it('asks for parallels, created order, and the max page size', () => {
    expect(seriesDetailCardListInput('ptcg-sc-csv10', 2)).toEqual({
      seriesSlug: 'ptcg-sc-csv10',
      includeParallels: true,
      sort: 'created',
      page: 2,
      pageSize: SERIES_DETAIL_CARD_LIST_PAGE_SIZE,
    });
    expect(SERIES_DETAIL_CARD_LIST_PAGE_SIZE).toBe(100);
  });
});

describe('seriesDetailCardListPageCount', () => {
  it('uses the first page total and falls back when pageSize is 0', () => {
    expect(seriesDetailCardListPageCount(0, 100)).toBe(0);
    expect(seriesDetailCardListPageCount(100, 100)).toBe(1);
    expect(seriesDetailCardListPageCount(287, 100)).toBe(3);
    expect(seriesDetailCardListPageCount(287, 0)).toBe(3);
  });
});

describe('remainingSeriesDetailCardListPages', () => {
  it('returns later page numbers in order', () => {
    expect(remainingSeriesDetailCardListPages(0, 100)).toEqual([]);
    expect(remainingSeriesDetailCardListPages(100, 100)).toEqual([]);
    expect(remainingSeriesDetailCardListPages(101, 100)).toEqual([2]);
    expect(remainingSeriesDetailCardListPages(287, 100)).toEqual([2, 3]);
  });
});

describe('collectSeriesDetailCardPages', () => {
  it('returns the first page when that is the whole list', async () => {
    const fetchPage = vi.fn(async (input: { page: number }) => ({
      items: input.page === 1 ? [{ slug: 'a' }] : [{ slug: 'should-not-fetch' }],
      total: 1,
      pageSize: 100,
    }));
    await expect(collectSeriesDetailCardPages(fetchPage, 'forge-of-titans')).resolves.toEqual({
      items: [{ slug: 'a' }],
      total: 1,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(seriesDetailCardListInput('forge-of-titans', 1));
  });

  it('stitches later pages in order and keeps the first-page total', async () => {
    const fetchPage = vi.fn(async (input: { page: number }) => {
      if (input.page === 1) {
        return {
          items: Array.from({ length: 100 }, (_, index) => ({ slug: `p1-${index}` })),
          total: 250,
          pageSize: 100,
        };
      }
      if (input.page === 2) {
        return {
          items: Array.from({ length: 100 }, (_, index) => ({ slug: `p2-${index}` })),
          total: 250,
          pageSize: 100,
        };
      }
      return {
        items: Array.from({ length: 50 }, (_, index) => ({ slug: `p3-${index}` })),
        total: 250,
        pageSize: 100,
      };
    });
    const result = await collectSeriesDetailCardPages(fetchPage, 'ptcg-sc-csv10');
    expect(result.total).toBe(250);
    expect(result.items).toHaveLength(250);
    expect(result.items[0]).toEqual({ slug: 'p1-0' });
    expect(result.items[100]).toEqual({ slug: 'p2-0' });
    expect(result.items[200]).toEqual({ slug: 'p3-0' });
    expect(result.items[249]).toEqual({ slug: 'p3-49' });
    expect(fetchPage.mock.calls.map((call) => call[0].page)).toEqual([1, 2, 3]);
  });

  it('does not return a partial list when a later page fails', async () => {
    const fetchPage = vi.fn(async (input: { page: number }) => {
      if (input.page === 1) {
        return { items: [{ slug: 'first' }], total: 150, pageSize: 100 };
      }
      throw new Error('page 2 failed');
    });
    await expect(collectSeriesDetailCardPages(fetchPage, 'forge-of-titans')).rejects.toThrow(
      'page 2 failed',
    );
  });
});
