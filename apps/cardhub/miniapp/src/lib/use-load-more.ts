import { useCallback, useRef, useState } from 'react';
import { nextNoticeId, type Notice } from './notice';

export type LoadMorePage<T> = {
  items: T[];
  nextCursor: string | null;
};

/**
 * Append-only pagination for the forum list and topic replies.
 * A ref blocks same-tick double taps (`useState` would still see
 * `moreLoading` as false). A sequence number drops a page that was
 * in flight when the list was reset (tab hide/show or a first-page
 * refresh), so an old page is never appended to a new first page.
 */
export function useLoadMore<T>(initial?: { extra?: T[]; moreCursor?: string | null }): {
  extra: T[];
  moreCursor: string | null;
  moreLoading: boolean;
  moreFailed: Notice<{ text: string }> | null;
  loadMore: (args: {
    cursor: string | null;
    fetchPage: (cursor: string) => Promise<LoadMorePage<T>>;
    failedText: string;
  }) => Promise<void>;
  reset: () => void;
} {
  const [extra, setExtra] = useState<T[]>(initial?.extra ?? []);
  const [moreCursor, setMoreCursor] = useState<string | null>(initial?.moreCursor ?? null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState<Notice<{ text: string }> | null>(null);
  const pendingRef = useRef(false);
  const requestId = useRef(0);

  const reset = useCallback(() => {
    requestId.current += 1;
    pendingRef.current = false;
    setExtra([]);
    setMoreCursor(null);
    setMoreFailed(null);
    setMoreLoading(false);
  }, []);

  const loadMore = useCallback(
    async (args: {
      cursor: string | null;
      fetchPage: (cursor: string) => Promise<LoadMorePage<T>>;
      failedText: string;
    }): Promise<void> => {
      if (!args.cursor || pendingRef.current) return;
      pendingRef.current = true;
      requestId.current += 1;
      const current = requestId.current;
      setMoreLoading(true);
      setMoreFailed(null);
      try {
        const page = await args.fetchPage(args.cursor);
        if (current !== requestId.current) return;
        setExtra((items) => [...items, ...page.items]);
        setMoreCursor(page.nextCursor);
      } catch {
        if (current !== requestId.current) return;
        setMoreFailed({ id: nextNoticeId(), text: args.failedText });
      } finally {
        if (current === requestId.current) {
          pendingRef.current = false;
          setMoreLoading(false);
        }
      }
    },
    [],
  );

  return { extra, moreCursor, moreLoading, moreFailed, loadMore, reset };
}
