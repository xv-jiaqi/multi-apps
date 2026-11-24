import { useCallback, useRef, useState } from 'react';
import type { BlockState } from './block-view';
import { classifyLoadError } from './load-error';
import { nextNoticeId } from './notice';

/**
 * One block-level read (a page section). Keeps the previous failure while a
 * retry runs so the red box can show 「重试中…」, and ignores responses
 * from a superseded request.
 */
export function useBlock<T>(fetcher: () => Promise<T>): {
  state: BlockState<T>;
  load: () => Promise<void>;
} {
  const [state, setState] = useState<BlockState<T>>({ data: null, failure: null, loading: true });
  const requestId = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    requestId.current += 1;
    const current = requestId.current;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await fetcherRef.current();
      if (current !== requestId.current) return;
      setState({ data, failure: null, loading: false });
    } catch (error) {
      if (current !== requestId.current) return;
      setState({
        data: null,
        failure: { id: nextNoticeId(), ...classifyLoadError(error) },
        loading: false,
      });
    }
  }, []);

  return { state, load };
}
