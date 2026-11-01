import type { QueryClient } from '@tanstack/react-query';

let client: QueryClient | null = null;

export function bindNotificationQueryClient(next: QueryClient): void {
  client = next;
}

export function clearNotificationCache(): void {
  client?.removeQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return Array.isArray(head) && head[0] === 'notifications';
    },
  });
}
