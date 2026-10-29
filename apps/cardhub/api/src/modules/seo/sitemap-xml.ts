import { slugSchema } from '@repo/shared';
import { z } from 'zod';

/** Page size for the id cursor. 100 pages is the 50,000 URL sitemap cap per kind. */
export const SITEMAP_PAGE_SIZE = 500;
export const SITEMAP_MAX_PAGES = 100;

const sitemapPathSchema = z.string().regex(/^\/(?:series|cards|forum)\/[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const sitemapRowSchema = z.object({
  slug: slugSchema,
  updatedAt: z.date().refine((value) => !Number.isNaN(value.getTime())),
});

export type SitemapRow = z.infer<typeof sitemapRowSchema>;

export type SitemapUrl = {
  path: string;
  updatedAt: Date;
};

const LAST_MOD = /^\d{4}-\d{2}-\d{2}$/;

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return char;
    }
  });
}

/** W3C date (`YYYY-MM-DD`). Years outside 0000–9999 are omitted, not rejected. */
export function sitemapLastMod(updatedAt: Date): string | undefined {
  if (Number.isNaN(updatedAt.getTime())) return undefined;
  const day = updatedAt.toISOString().slice(0, 10);
  return LAST_MOD.test(day) ? day : undefined;
}

/**
 * One urlset. Invalid paths are dropped so a bad slug cannot break the
 * document or point outside the public series, card, and topic routes.
 */
export function renderSitemap(origin: string, urls: readonly SitemapUrl[]): string {
  const lines: string[] = [];
  for (const url of urls) {
    const path = sitemapPathSchema.safeParse(url.path);
    if (!path.success) continue;
    const loc = escapeXml(`${origin}${path.data}`);
    const lastMod = sitemapLastMod(url.updatedAt);
    if (lastMod === undefined) {
      lines.push(`  <url>\n    <loc>${loc}</loc>\n  </url>`);
    } else {
      lines.push(`  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastMod}</lastmod>\n  </url>`);
    }
  }
  const body = lines.length === 0 ? '' : `\n${lines.join('\n')}\n`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`,
    '',
  ].join('\n');
}
