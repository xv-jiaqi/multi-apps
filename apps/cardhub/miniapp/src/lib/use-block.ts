import { useCallback, useRef, useState } from 'react';
import type { BlockState } from './block-view';
import { classifyLoadError } from './load-error';
import { nextNoticeId } from './notice';

export interface LoadOptions {
  /**
   * Always send a new request, even while one is running. Use after a write
   * (posting a comment, reply or topic) so the list includes it: a request
   * already in flight was sent before the write and may not.
   */
  fresh?: boolean;
  /**
   * After a successful write, keep the data already on screen if the
   * refresh fails, and reject so the caller can toast. The block does
   * not switch to a full-page error.
   */
  keepDataOnError?: boolean;
}

/**
 * One block-level read (a page section). Keeps the previous failure while a
 * retry runs so the red box can show 「重试中…」.
 *
 * Mount and retry calls (`load()`) join a request that is already running,
 * so a double mount or a retry tapped twice sends one request. `load({ fresh:
 * true })` always sends a new one. Only the response to the most recently sent
 * request updates the state; older responses are dropped.
 */
export function useBlock<T>(
  fetcher: () => Promise<T>,
  initial?: T | null,
): {
  state: BlockState<T>;
  load: (options?: LoadOptions) => Promise<void>;
} {
  const [state, setState] = useState<BlockState<T>>(
    initial
      ? { data: initial, failure: null, loading: false }
      : { data: null, failure: null, loading: true },
  );
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback((options?: LoadOptions): Promise<void> => {
    if (inFlight.current && !options?.fresh) return inFlight.current;

    requestId.current += 1;
    const current = requestId.current;
    let settle!: () => void;
    let reject!: (error: unknown) => void;
    const run = new Promise<void>((resolve, rej) => {
      settle = resolve;
      reject = rej;
    });
    // Register before calling the fetcher: a fetcher that throws synchronously
    // finishes inside the call, and its cleanup must see this request.
    inFlight.current = run;
    setState((prev) => ({ ...prev, loading: true }));

    let settleError: unknown;
    void (async () => {
      try {
        const data = await fetcherRef.current();
        if (current === requestId.current) setState({ data, failure: null, loading: false });
      } catch (error) {
        if (current === requestId.current) {
          if (options?.keepDataOnError) {
            setState((prev) => ({ ...prev, loading: false }));
            settleError = error;
          } else {
            setState({
              data: null,
              failure: { id: nextNoticeId(), ...classifyLoadError(error) },
              loading: false,
            });
          }
        }
      } finally {
        if (inFlight.current === run) inFlight.current = null;
        if (settleError) reject(settleError);
        else settle();
      }
    })();
    return run;
  }, []);

  return { state, load };
}
