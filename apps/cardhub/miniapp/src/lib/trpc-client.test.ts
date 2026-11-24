import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_SURFACE_HEADER } from '@repo/shared';
import { createMiniappTrpcClient } from './trpc-client';

type Sent = { url: string; method: string; headers: Headers };

function recordingFetch(body: unknown) {
  const sent: Sent[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    sent.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { sent, fakeFetch };
}

function client(args: { token: string | null; body: unknown }) {
  const { sent, fakeFetch } = recordingFetch(args.body);
  const trpc = createMiniappTrpcClient({
    url: 'https://api.cardhub.test/trpc',
    fetch: fakeFetch,
    getToken: () => args.token,
  });
  return { sent, trpc };
}

describe('miniapp tRPC client', () => {
  it('sends the miniapp surface header on a signed-out read', async () => {
    const { sent, trpc } = client({
      token: null,
      body: { result: { data: { items: [], nextCursor: null } } },
    });
    await trpc.forum.topics.list.query({ limit: 5 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('GET');
    expect(sent[0]?.headers.get(CONTENT_SURFACE_HEADER)).toBe('miniapp');
    expect(sent[0]?.headers.get('authorization')).toBeNull();
  });

  it('sends the miniapp surface header next to the session token', async () => {
    const { sent, trpc } = client({
      token: 'session-token',
      body: { result: { data: [] } },
    });
    await trpc.listings.byCard.query({ cardSlug: 'some-card', limit: 5 });
    expect(sent[0]?.headers.get(CONTENT_SURFACE_HEADER)).toBe('miniapp');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer session-token');
  });

  it('is the only way the miniapp builds a tRPC client', () => {
    const srcDir = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(srcDir);
    const builders = files
      .filter((path) =>
        /\b(createTRPCClient|createTRPCProxyClient|httpLink|httpBatchLink)\b/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative(srcDir, path));
    expect(builders).toEqual(['lib/trpc-client.ts']);
    expect(readFileSync(join(srcDir, 'lib/trpc.ts'), 'utf8')).toContain('createMiniappTrpcClient(');
  });
});
