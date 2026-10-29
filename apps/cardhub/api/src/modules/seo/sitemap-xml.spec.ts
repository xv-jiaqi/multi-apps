import { escapeXml, renderSitemap, sitemapLastMod } from './sitemap-xml';

const ORIGIN = 'https://card-hub.app';
const UPDATED = new Date('2026-10-29T15:04:00.000Z');

describe('sitemap xml', () => {
  it('escapes XML special characters', () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });

  it('renders series, card, and topic URLs with a W3C lastmod', () => {
    const xml = renderSitemap(ORIGIN, [
      { path: '/series/base-set', updatedAt: UPDATED },
      { path: '/cards/charizard', updatedAt: UPDATED },
      { path: '/forum/topic-ab12cd', updatedAt: UPDATED },
    ]);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain(
      '<url>\n    <loc>https://card-hub.app/series/base-set</loc>\n    <lastmod>2026-10-29</lastmod>\n  </url>',
    );
    expect(xml).toContain('<loc>https://card-hub.app/cards/charizard</loc>');
    expect(xml).toContain('<loc>https://card-hub.app/forum/topic-ab12cd</loc>');
    expect(xml).not.toContain('/reports');
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/me');
  });

  it('drops paths that are not public series, card, or topic URLs', () => {
    const xml = renderSitemap(ORIGIN, [
      { path: '/series/ok-slug', updatedAt: UPDATED },
      { path: '/admin/users', updatedAt: UPDATED },
      { path: '/series/Not_A_Slug', updatedAt: UPDATED },
      { path: 'https://evil.example/series/ok-slug', updatedAt: UPDATED },
    ]);

    expect(xml).toContain('<loc>https://card-hub.app/series/ok-slug</loc>');
    expect(xml).not.toContain('admin');
    expect(xml).not.toContain('Not_A_Slug');
    expect(xml).not.toContain('evil.example');
  });

  it('omits lastmod when the timestamp is outside the W3C year range', () => {
    expect(sitemapLastMod(new Date('2026-10-29T00:00:00.000Z'))).toBe('2026-10-29');
    expect(sitemapLastMod(new Date(Number.NaN))).toBeUndefined();

    const xml = renderSitemap(ORIGIN, [
      { path: '/cards/future-card', updatedAt: new Date('10000-01-01T00:00:00.000Z') },
    ]);
    expect(xml).toContain('<loc>https://card-hub.app/cards/future-card</loc>');
    expect(xml).not.toContain('<lastmod>');
  });

  it('returns an empty urlset when there is nothing to publish', () => {
    expect(renderSitemap(ORIGIN, [])).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
        '',
      ].join('\n'),
    );
  });
});
