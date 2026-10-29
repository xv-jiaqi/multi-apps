import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const ORIGIN = 'http://127.0.0.1:5173';

describe('GET /sitemap.xml', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  const previousOrigin = process.env.PUBLIC_WEB_ORIGIN;
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const seriesSlug = `sm-series-${suffix}`;
  const cardSlug = `sm-card-${suffix}`;
  const topicSlug = `sm-topic-${suffix}`;
  const badSlug = `Not_Valid_${suffix}`;
  const email = `sm${suffix}@cardhub.test`;
  const username = `sm${suffix}`.replace(/[^a-z0-9]/g, '').slice(0, 24);

  beforeAll(async () => {
    process.env.PUBLIC_WEB_ORIGIN = ORIGIN;
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);

    const series = await prisma.series.create({
      data: { slug: seriesSlug, title: 'Sitemap series' },
    });
    await prisma.series.create({
      data: { slug: badSlug, title: 'Skipped series' },
    });
    await prisma.card.create({
      data: { slug: cardSlug, name: 'Sitemap card', seriesId: series.id },
    });
    const user = await prisma.user.create({
      data: { email, username, password: 'sitemap-test-hash' },
    });
    await prisma.topic.create({
      data: {
        slug: topicSlug,
        title: 'Sitemap topic',
        body: 'A topic that should be listed.',
        userId: user.id,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.series.deleteMany({ where: { slug: { in: [seriesSlug, badSlug] } } });
      await prisma.user.deleteMany({ where: { email } });
    }
    if (previousOrigin === undefined) delete process.env.PUBLIC_WEB_ORIGIN;
    else process.env.PUBLIC_WEB_ORIGIN = previousOrigin;
    await app?.close();
  });

  it('returns series, card, and topic URLs and skips a slug that is not kebab-case', async () => {
    if (!app || !prisma) throw new Error('sitemap app was not created');
    const response = await request(app.getHttpServer()).get('/sitemap.xml');
    const series = await prisma.series.findUnique({ where: { slug: seriesSlug } });
    const card = await prisma.card.findUnique({ where: { slug: cardSlug } });
    const topic = await prisma.topic.findUnique({ where: { slug: topicSlug } });
    if (!series || !card || !topic) throw new Error('sitemap fixtures missing');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/xml/);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(response.text).toContain(
      `<loc>${ORIGIN}/series/${seriesSlug}</loc>\n    <lastmod>${series.updatedAt.toISOString().slice(0, 10)}</lastmod>`,
    );
    expect(response.text).toContain(
      `<loc>${ORIGIN}/cards/${cardSlug}</loc>\n    <lastmod>${card.updatedAt.toISOString().slice(0, 10)}</lastmod>`,
    );
    expect(response.text).toContain(
      `<loc>${ORIGIN}/forum/${topicSlug}</loc>\n    <lastmod>${topic.updatedAt.toISOString().slice(0, 10)}</lastmod>`,
    );
    expect(response.text).not.toContain(badSlug);
    expect(response.text).not.toContain('<!DOCTYPE');
  });
});
