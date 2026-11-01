import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { bindNotificationQueryClient, clearNotificationCache } from './notification-cache';

describe('clearNotificationCache', () => {
  it('removes notification queries and leaves the rest', () => {
    const queryClient = new QueryClient();
    bindNotificationQueryClient(queryClient);
    queryClient.setQueryData([['notifications', 'unreadCount'], { type: 'query' }], { count: 3 });
    queryClient.setQueryData([['forum', 'topics'], { type: 'query' }], { items: [] });

    clearNotificationCache();

    expect(
      queryClient.getQueryData([['notifications', 'unreadCount'], { type: 'query' }]),
    ).toBeUndefined();
    expect(queryClient.getQueryData([['forum', 'topics'], { type: 'query' }])).toEqual({
      items: [],
    });
  });
});
