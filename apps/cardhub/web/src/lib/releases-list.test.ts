import { describe, expect, it } from 'vitest';
import { interpretReleasesResponse, ReleasesRequestError } from './releases-list';

const item = {
  id: 'r1',
  title: '春季补充包',
  releaseDate: '2026-11-06',
  region: 'JP',
  note: '备注',
  sourceUrl: 'https://example.invalid/src',
  series: { slug: 'celestial-dawn', title: '天穹黎明', coverUrl: null },
  category: { slug: 'deck-builder', name: '构筑对战' },
};

describe('interpretReleasesResponse', () => {
  it('hides a missing procedure and an empty list', () => {
    expect(
      interpretReleasesResponse(404, {
        error: { data: { code: 'NOT_FOUND', httpStatus: 404 } },
      }),
    ).toEqual({ absent: true, items: [] });
    expect(interpretReleasesResponse(200, { result: { data: { items: [] } } })).toEqual({
      absent: false,
      items: [],
    });
  });

  it('reads the first items from a successful list', () => {
    const parsed = interpretReleasesResponse(200, {
      result: { data: { items: [item, { id: 1 }] } },
    });
    expect(parsed.absent).toBe(false);
    if (parsed.absent) return;
    expect(parsed.items).toEqual([item]);
  });

  it('treats server failures as errors instead of an empty calendar', () => {
    expect(() =>
      interpretReleasesResponse(500, { error: { data: { code: 'INTERNAL_SERVER_ERROR' } } }),
    ).toThrow(ReleasesRequestError);
    expect(() => interpretReleasesResponse(200, { result: { data: { releases: [] } } })).toThrow(
      ReleasesRequestError,
    );
  });
});
