import { vi } from 'vitest';
import type { AuditRow } from './audit';

export interface AuditPageData {
  pages: Array<{ items: AuditRow[]; total: number; nextCursor: string | null }>;
  pageParams: unknown[];
}

export const auditMock: {
  inputs: unknown[];
  data: AuditPageData;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
  fetchNextPage: ReturnType<typeof vi.fn>;
} = {
  inputs: [],
  data: {
    pages: [{ items: [], total: 0, nextCursor: null }],
    pageParams: [null],
  },
  isLoading: false,
  isError: false,
  isFetching: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  hasNextPage: false,
  error: null,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(async () => ({ isError: false, hasNextPage: false, data: auditMock.data })),
};

export function resetAuditMock() {
  auditMock.inputs = [];
  auditMock.data = { pages: [{ items: [], total: 0, nextCursor: null }], pageParams: [null] };
  auditMock.isLoading = false;
  auditMock.isError = false;
  auditMock.isFetching = false;
  auditMock.isFetchingNextPage = false;
  auditMock.isFetchNextPageError = false;
  auditMock.hasNextPage = false;
  auditMock.error = null;
  auditMock.refetch.mockReset();
  auditMock.fetchNextPage.mockReset();
  auditMock.fetchNextPage.mockImplementation(async () => ({
    isError: false,
    hasNextPage: auditMock.hasNextPage,
    data: auditMock.data,
  }));
}

function queryResult() {
  return {
    data: auditMock.isError && !auditMock.isFetchNextPageError ? undefined : auditMock.data,
    isLoading: auditMock.isLoading,
    isError: auditMock.isError,
    isFetching: auditMock.isFetching,
    isFetchingNextPage: auditMock.isFetchingNextPage,
    isFetchNextPageError: auditMock.isFetchNextPageError,
    hasNextPage: auditMock.hasNextPage,
    error: auditMock.error,
    refetch: auditMock.refetch,
    fetchNextPage: auditMock.fetchNextPage,
  };
}

export const auditTrpcMock = {
  trpc: {
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
      },
    },
    admin: {
      audit: {
        list: {
          useInfiniteQuery: (input: unknown) => {
            auditMock.inputs.push(input);
            return queryResult();
          },
        },
      },
    },
  },
};
