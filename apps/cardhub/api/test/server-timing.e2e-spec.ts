import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';

const QUERY_MARKER = 'QUERY_TEXT_MARKER_z9';
const USER_MARKER = 'user-marker-7f3a@cardhub.test';
const ALLOWED_ORIGIN = 'http://localhost:5173';

function timingHeader(response: { headers: Record<string, string | undefined> }): string {
  return response.headers['server-timing'] ?? '';
}

function duration(timing: string, name: string): number {
  const match = new RegExp(`(?:^|, )${name};dur=(\\d+(?:\\.\\d+)?)(?:,|$)`).exec(timing);
  if (!match?.[1]) throw new Error(`missing ${name} in ${timing}`);
  return Number(match[1]);
}

describe('Server-Timing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns app duration without query text or user identifiers', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .query({ q: QUERY_MARKER })
      .set('Origin', ALLOWED_ORIGIN)
      .set('X-Debug-User', USER_MARKER);

    expect(response.status).toBe(200);
    const timing = timingHeader(response);
    expect(timing).toMatch(/(?:^|, )app;dur=\d+(?:\.\d+)?(?:,|$)/);
    expect(timing).toMatch(/(?:^|, )db;dur=\d+(?:\.\d+)?(?:,|$)/);
    expect(timing).toMatch(/(?:^|, )cache;dur=\d+(?:\.\d+)?(?:,|$)/);
    expect(timing).not.toContain(QUERY_MARKER);
    expect(timing).not.toContain(USER_MARKER);
    expect(timing).not.toContain('SELECT');
    expect(timing).not.toContain('prisma');
    expect(timing).not.toContain('cardhub:');
    expect(duration(timing, 'db')).toBeGreaterThan(0);
    expect(response.headers['timing-allow-origin']).toBe(ALLOWED_ORIGIN);

    const listed = await request(app.getHttpServer())
      .get('/trpc/series.list')
      .set('Origin', ALLOWED_ORIGIN);
    expect(listed.status).toBe(200);
    expect(duration(timingHeader(listed), 'cache')).toBeGreaterThan(0);
    expect(duration(timingHeader(listed), 'db')).toBeGreaterThan(0);
  });

  it('sends Timing-Allow-Origin on preflight only for an allowed origin', async () => {
    // CI sets CORS_ORIGIN to this origin and replaces the default allowlist.
    const allowed = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(allowed.headers['timing-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    const rejected = await request(app.getHttpServer())
      .options('/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(rejected.headers['timing-allow-origin']).toBeUndefined();
    expect(rejected.headers['timing-allow-origin']).not.toBe('*');
  });

  it('keeps Server-Timing on a rejected body and still hides the payload text', async () => {
    const response = await request(app.getHttpServer())
      .post('/trpc/comments.create')
      .set('Content-Type', 'application/json')
      .set('Origin', ALLOWED_ORIGIN)
      .send(`{"content":"${QUERY_MARKER}"`);

    expect(response.status).toBe(400);
    const timing = timingHeader(response);
    expect(timing).toMatch(/(?:^|, )app;dur=\d+(?:\.\d+)?(?:,|$)/);
    expect(timing).not.toContain(QUERY_MARKER);
    expect(timing).not.toContain('SyntaxError');
    expect(response.headers['timing-allow-origin']).toBe(ALLOWED_ORIGIN);
  });
});
