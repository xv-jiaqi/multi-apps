import { useCallback, useRef, useState } from 'react';
import type { BlockState } from './block-view';
import { classifyLoadError } from './load-error';
import { nextNoticeId } from './notice';

/**
 * One block-level read (a page section). Keeps the previous failure while a
 * retry runs so the red box can show 「重试中…」.
 *
 * One request at a time: a call while a request is running (double mount,
 * retry tapped twice, a refresh during the first load) joins that request
 * and gets the same promise; the next call after it settles starts a new one.
 */
export function useBlock<T>(fetcher: () => Promise<T>): {
  state: BlockState<T>;
  load: () => Promise<void>;
} {
  const [state, setState] = useState<BlockState<T>>({ data: null, failure: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      setState((prev) => ({ ...prev, loading: true }));
      try {
        const data = await fetcherRef.current();
        setState({ data, failure: null, loading: false });
      } catch (error) {
        setState({
          data: null,
          failure: { id: nextNoticeId(), ...classifyLoadError(error) },
          loading: false,
        });
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  return { state, load };
}
