import type { LoadFailureKind } from './load-error';
import type { Notice } from './notice';

export type BlockState<T> = {
  data: T | null;
  failure: Notice<{ kind: LoadFailureKind }> | null;
  loading: boolean;
};

export type BlockView<T> =
  | { kind: 'failed'; noticeId: number; retrying: boolean }
  | { kind: 'notFound' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'success'; data: T };

/**
 * Error before loading (cardhub-pr-checklist A.7): while a retry is in
 * flight the red box stays and its button reads 「重试中…」. A failure never
 * falls through to the empty state (CH-301 §6).
 */
export function resolveBlockView<T>(args: {
  state: BlockState<T>;
  isEmpty: (data: T) => boolean;
}): BlockView<T> {
  const { data, failure, loading } = args.state;
  if (failure) {
    if (failure.kind === 'notFound') return { kind: 'notFound' };
    return { kind: 'failed', noticeId: failure.id, retrying: loading };
  }
  // A refresh with data on screen keeps the data (no skeleton flash).
  if (data === null) return { kind: 'loading' };
  if (args.isEmpty(data)) return { kind: 'empty' };
  return { kind: 'success', data };
}
