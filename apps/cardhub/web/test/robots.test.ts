import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const robotsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/robots.txt',
);

const PRODUCTION_ROBOTS = [
  'User-agent: *',
  'Disallow: /reports',
  'Disallow: /admin',
  'Disallow: /me',
  '',
  'Sitemap: https://card-hub.app/sitemap.xml',
  '',
].join('\n');

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (
        address !== null &&
        typeof address === 'object' &&
        'port' in address &&
        typeof address.port === 'number'
      ) {
        resolve(address.port);
        return;
      }
      reject(new Error('robots test server did not bind a port'));
    });
  });
}

describe('GET /robots.txt', () => {
  it('points at the sitemap and disallows reports, admin, and me', async () => {
    const body = readFileSync(robotsPath, 'utf8');
    expect(body).toBe(PRODUCTION_ROBOTS);

    const server = createServer((req, res) => {
      if (req.url === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    });

    try {
      const port = await listen(server);
      const response = await fetch(`http://127.0.0.1:${port}/robots.txt`);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(text).toBe(PRODUCTION_ROBOTS);
      expect(text).toContain('Disallow: /reports');
      expect(text).toContain('Disallow: /admin');
      expect(text).toContain('Disallow: /me');
      expect(text).toContain('Sitemap: https://card-hub.app/sitemap.xml');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
