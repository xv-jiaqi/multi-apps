import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { clearActiveQueryClient, TrpcProvider } from './trpc';

// tRPC v11 react-query keys: [path segments, { input, type }].
const KEYS = {
  topic: [['forum', 'topics', 'bySlug'], { input: { slug: 't' }, type: 'query' }],
  list: [['forum', 'topics', 'list'], { input: { limit: 20 }, type: 'infinite' }],
  replies: [['forum', 'replies', 'list'], { input: { topicId: 'x', limit: 20 }, type: 'infinite' }],
  me: [['auth', 'me'], { type: 'query' }],
  unread: [['notifications', 'unreadCount'], { type: 'query' }],
  collection: [['collection', 'byCard'], { input: { cardId: 'c' }, type: 'query' }],
};

function mountClient(): QueryClient {
  let client: QueryClient | null = null;
  function Grab() {
    client = useQueryClient();
    return null;
  }
  render(
    <TrpcProvider>
      <Grab />
    </TrpcProvider>,
  );
  if (!client) throw new Error('QueryClient did not mount');
  const mounted: QueryClient = client;
  Object.values(KEYS).forEach((key) => mounted.setQueryData(key, { seeded: true }));
  return mounted;
}

function cachedKeys(client: QueryClient): string[] {
  return client
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.queryKey[0]))
    .sort();
}

describe('clearActiveQueryClient (CH-226 §5)', () => {
  it('keeps only the public forum reads on a silent forum sign-out', () => {
    const client = mountClient();
    act(() => clearActiveQueryClient({ scope: 'keepPublicForumReads' }));
    expect(cachedKeys(client)).toEqual(
      [
        JSON.stringify(['forum', 'replies', 'list']),
        JSON.stringify(['forum', 'topics', 'bySlug']),
        JSON.stringify(['forum', 'topics', 'list']),
      ].sort(),
    );
    expect(client.getQueryData(KEYS.topic)).toEqual({ seeded: true });
  });

  it('clears everything by default, as before', () => {
    const client = mountClient();
    act(() => clearActiveQueryClient());
    expect(cachedKeys(client)).toEqual([]);
  });
});
