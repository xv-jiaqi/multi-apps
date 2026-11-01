import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../app';
import { FOOTER_LINKS } from './site-footer';

describe('footer links', () => {
  it('points at pages that exist, including the release calendar', () => {
    expect(FOOTER_LINKS.map((link) => link.href)).toEqual([
      '/categories',
      '/series',
      '/calendar',
      '/forum',
      '/trade',
    ]);
    for (const link of FOOTER_LINKS) {
      const match = matchRoutes(appRoutes, link.href)?.at(-1)?.route.path;
      expect(match).toBe(link.href);
    }
  });
});
