import { describe, expect, it } from 'vitest';
import { latestExcludingHero, pickHomeHero, type HomeSeries } from './home-hero';

const today = '2026-11-01';

function series(slug: string, releaseDate: string | null): HomeSeries {
  return {
    slug,
    title: slug,
    description: null,
    coverUrl: null,
    cardCount: 1,
    releaseDate,
  };
}

describe('pickHomeHero', () => {
  it('keeps the filtered series when its release date is on or before today', () => {
    const past = series('past', '2026-10-01');
    const tomorrow = series('tomorrow', '2026-11-02');
    expect(pickHomeHero(past, [tomorrow, past], today)).toEqual({
      series: past,
      kind: 'recent',
    });
    expect(pickHomeHero(series('today', today), [], today)?.kind).toBe('recent');
  });

  it('does not promote a future filtered row, and falls back to the newest series', () => {
    const tomorrow = series('tomorrow', '2026-11-02');
    const newest = series('undated', null);
    expect(pickHomeHero(tomorrow, [newest, tomorrow], today)).toEqual({
      series: newest,
      kind: 'latest',
    });
    expect(pickHomeHero(undefined, [newest], today)).toEqual({
      series: newest,
      kind: 'latest',
    });
    expect(pickHomeHero(undefined, [], today)).toBeNull();
  });

  it('drops the hero from the newest eight', () => {
    const rows = Array.from({ length: 9 }, (_, index) => series(`s${index}`, null));
    expect(latestExcludingHero(rows, 's0').map((item) => item.slug)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
      's8',
    ]);
    expect(latestExcludingHero(rows, 'missing')).toHaveLength(8);
    const only = rows[0];
    if (!only) throw new Error('expected a series');
    expect(latestExcludingHero([only], only.slug)).toEqual([]);
  });
});
