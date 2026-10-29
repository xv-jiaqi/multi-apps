import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePublicWebOrigin } from './public-web-origin';
import {
  SITEMAP_MAX_PAGES,
  SITEMAP_PAGE_SIZE,
  renderSitemap,
  sitemapRowSchema,
  type SitemapRow,
  type SitemapUrl,
} from './sitemap-xml';

type SourceRow = {
  id: string;
  slug: string;
  updatedAt: Date;
};

function configString(config: ConfigService, key: string): string | undefined {
  const value = config.get<unknown>(key);
  return typeof value === 'string' ? value : undefined;
}

function sortRows(entries: SitemapRow[]): SitemapRow[] {
  return [...entries].sort((left, right) => left.slug.localeCompare(right.slug));
}

async function loadRows(
  fetchPage: (cursor: string | undefined) => Promise<SourceRow[]>,
): Promise<SitemapRow[]> {
  const entries: SitemapRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < SITEMAP_MAX_PAGES; page += 1) {
    const rows = await fetchPage(cursor);
    for (const row of rows) {
      const parsed = sitemapRowSchema.safeParse({
        slug: row.slug,
        updatedAt: row.updatedAt,
      });
      if (parsed.success) entries.push(parsed.data);
    }
    const last = rows[rows.length - 1];
    if (rows.length < SITEMAP_PAGE_SIZE || last === undefined) return sortRows(entries);
    cursor = last.id;
  }
  return sortRows(entries);
}

function toUrls(prefix: '/series' | '/cards' | '/forum', rows: readonly SitemapRow[]): SitemapUrl[] {
  return rows.map((row) => ({
    path: `${prefix}/${row.slug}`,
    updatedAt: row.updatedAt,
  }));
}

@Injectable()
export class SitemapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async render(): Promise<string> {
    const origin = resolvePublicWebOrigin({
      nodeEnv: configString(this.config, 'NODE_ENV'),
      publicWebOrigin: configString(this.config, 'PUBLIC_WEB_ORIGIN'),
      corsOrigin: configString(this.config, 'CORS_ORIGIN'),
    });
    const [series, cards, topics] = await Promise.all([
      loadRows((cursor) =>
        this.prisma.series.findMany({
          select: { id: true, slug: true, updatedAt: true },
          orderBy: { id: 'asc' },
          take: SITEMAP_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        }),
      ),
      loadRows((cursor) =>
        this.prisma.card.findMany({
          select: { id: true, slug: true, updatedAt: true },
          orderBy: { id: 'asc' },
          take: SITEMAP_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        }),
      ),
      loadRows((cursor) =>
        this.prisma.topic.findMany({
          select: { id: true, slug: true, updatedAt: true },
          orderBy: { id: 'asc' },
          take: SITEMAP_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        }),
      ),
    ]);
    return renderSitemap(origin, [
      ...toUrls('/series', series),
      ...toUrls('/cards', cards),
      ...toUrls('/forum', topics),
    ]);
  }
}
