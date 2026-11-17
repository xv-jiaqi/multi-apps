import { describe, expect, it } from 'vitest';
import { seriesBySlugInput } from './index';

describe('seriesBySlugInput', () => {
  it('accepts a slug alone so existing callers stay valid', () => {
    expect(seriesBySlugInput.parse({ slug: 'celestial-dawn' })).toEqual({
      slug: 'celestial-dawn',
    });
  });

  it('accepts includeCards as an optional boolean', () => {
    expect(seriesBySlugInput.parse({ slug: 'celestial-dawn', includeCards: false })).toEqual({
      slug: 'celestial-dawn',
      includeCards: false,
    });
    expect(seriesBySlugInput.parse({ slug: 'celestial-dawn', includeCards: true })).toEqual({
      slug: 'celestial-dawn',
      includeCards: true,
    });
  });

  it('rejects a missing slug or a non-boolean includeCards', () => {
    expect(seriesBySlugInput.safeParse({}).success).toBe(false);
    expect(
      seriesBySlugInput.safeParse({ slug: 'celestial-dawn', includeCards: 'false' }).success,
    ).toBe(false);
  });
});
