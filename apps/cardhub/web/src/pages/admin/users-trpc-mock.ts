import { useEffect } from 'react';
import { vi } from 'vitest';
import type { AdminUserRow } from './users';

export interface UsersPageData {
  pages: Array<{ items: AdminUserRow[]; total: number; nextCursor: string | null }>;
  pageParams: unknown[];
}

export const usersMock: {
  inputs: unknown[];
  data: UsersPageData;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
  fetchNextPage: ReturnType<typeof vi.fn>;
  banPending: boolean;
  unbanPending: boolean;
  ban: ReturnType<
    typeof vi.fn<(input: { userId: string; reason: string }) => Promise<AdminUserRow>>
  >;
  unban: ReturnType<
    typeof vi.fn<(input: { userId: string; reason: string }) => Promise<AdminUserRow>>
  >;
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
  error: null as unknown,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(async () => ({ isError: false, hasNextPage: false, data: usersMock.data })),
  banPending: false,
  unbanPending: false,
  ban: vi.fn(async (_input: { userId: string; reason: string }) => {
    throw new Error('ban mock was not set');
  }),
  unban: vi.fn(async (_input: { userId: string; reason: string }) => {
    throw new Error('unban mock was not set');
  }),
};

export function resetUsersMock() {
  usersMock.inputs = [];
  usersMock.data = { pages: [{ items: [], total: 0, nextCursor: null }], pageParams: [null] };
  usersMock.isLoading = false;
  usersMock.isError = false;
  usersMock.isFetching = false;
  usersMock.isFetchingNextPage = false;
  usersMock.isFetchNextPageError = false;
  usersMock.hasNextPage = false;
  usersMock.error = null;
  usersMock.refetch.mockReset();
  usersMock.fetchNextPage.mockReset();
  usersMock.fetchNextPage.mockImplementation(async () => ({
    isError: false,
    hasNextPage: usersMock.hasNextPage,
    data: usersMock.data,
  }));
  usersMock.banPending = false;
  usersMock.unbanPending = false;
  usersMock.ban.mockReset();
  usersMock.unban.mockReset();
}

function queryResult() {
  return {
    data: usersMock.isError && !usersMock.isFetchNextPageError ? undefined : usersMock.data,
    isLoading: usersMock.isLoading,
    isError: usersMock.isError,
    isFetching: usersMock.isFetching,
    isFetchingNextPage: usersMock.isFetchingNextPage,
    isFetchNextPageError: usersMock.isFetchNextPageError,
    hasNextPage: usersMock.hasNextPage,
    error: usersMock.error,
    refetch: usersMock.refetch,
    fetchNextPage: usersMock.fetchNextPage,
  };
}

export const usersTrpcMock = {
  trpc: {
    useUtils: () => ({
      admin: {
        users: {
          list: {
            setInfiniteData: (_input: unknown, updater: (data: UsersPageData) => UsersPageData) => {
              usersMock.data = updater(usersMock.data);
            },
          },
        },
      },
    }),
    search: {
      global: {
        useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
      },
    },
    admin: {
      users: {
        list: {
          useInfiniteQuery: (input: unknown) => {
            // Record after commit. Pushing during render lets a discarded
            // startTransition render report q=bob while the committed URL
            // is still the previous search.
            useEffect(() => {
              usersMock.inputs.push(input);
            }, [input]);
            return queryResult();
          },
        },
        ban: {
          useMutation: () => ({
            get isPending() {
              return usersMock.banPending;
            },
            mutateAsync: (input: { userId: string; reason: string }) => usersMock.ban(input),
          }),
        },
        unban: {
          useMutation: () => ({
            get isPending() {
              return usersMock.unbanPending;
            },
            mutateAsync: (input: { userId: string; reason: string }) => usersMock.unban(input),
          }),
        },
      },
    },
  },
};
