import { MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../api/client';
import { toast } from '../lib/toast';

/** TanStack 在每次失败时传入当前失败次数（从 0 开始），`< 3` 就是再试 3 次。 */
export function retryQuery(failureCount: number, error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NETWORK' && failureCount < 3;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError(error, _variables, _result, mutation) {
        if (silentError(mutation.options.meta)) return;
        toast.error(errorMessage(error));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: retryQuery,
      },
    },
  });
}

export const queryClient = createQueryClient();

function silentError(meta: object | undefined): boolean {
  if (!meta || !('silentError' in meta)) return false;
  return Reflect.get(meta, 'silentError') === true;
}
