import { describe, expect, it } from 'vitest';
import { gradientFor } from './gradients';

/**
 * The seed in apps/cardhub/api/prisma/seed.ts and gradients.ts are coupled —
 * Tailwind v4 JIT can only emit utility classes it sees in the source, so a
 * missing entry would render the affected series / card as a blank gray
 * tile. This test pins the contract so we notice the moment new seed data
 * lands without a matching mapping.
 */
const SEED_SLUGS = [
  // series
  'celestial-dawn',
  'verdant-rift',
  'forge-of-titans',
  // cards
  'aurora-knight',
  'glacier-sentinel',
  'moonlit-raven',
  'starlight-novice',
  'ancient-treant',
  'spore-warden',
  'amber-mystic',
  'forge-titan',
  'lava-wraith',
];

describe('gradientFor', () => {
  it.each(SEED_SLUGS)('has a Tailwind class for seeded slug %s', (slug) => {
    const klass = gradientFor(slug);
    expect(klass).not.toBe('from-neutral-200 via-neutral-300 to-neutral-400');
    expect(klass).toMatch(/^from-/);
    expect(klass).toMatch(/ via-/);
    expect(klass).toMatch(/ to-/);
  });

  it('falls back to a neutral gradient for unknown slugs', () => {
    expect(gradientFor('not-a-real-slug')).toBe('from-neutral-200 via-neutral-300 to-neutral-400');
  });

  it('handles null / undefined gracefully', () => {
    expect(gradientFor(null)).toBe('from-neutral-200 via-neutral-300 to-neutral-400');
    expect(gradientFor(undefined)).toBe('from-neutral-200 via-neutral-300 to-neutral-400');
  });
});
