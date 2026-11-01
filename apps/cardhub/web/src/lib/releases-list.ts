import { trpc } from './trpc';

export type ReleaseRegion = 'CN' | 'JP' | 'GLOBAL';

export type ReleaseListItem = {
  id: string;
  title: string;
  releaseDate: string;
  region: ReleaseRegion | null;
  note: string | null;
  sourceUrl: string | null;
  series: { slug: string; title: string; coverUrl: string | null } | null;
  category: { slug: string; name: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function procedureNotFound(error: unknown): boolean {
  if (!isRecord(error) || !isRecord(error.data)) return false;
  return error.data.code === 'NOT_FOUND';
}

function toListItem(item: {
  id: string;
  title: string;
  releaseDate: string;
  region: ReleaseListItem['region'];
  note: string | null;
  sourceUrl: string | null;
  series: ReleaseListItem['series'];
  category: ReleaseListItem['category'];
}): ReleaseListItem {
  return {
    id: item.id,
    title: item.title,
    releaseDate: item.releaseDate,
    region: item.region,
    note: item.note,
    sourceUrl: item.sourceUrl,
    series: item.series,
    category: item.category,
  };
}

/** Home upcoming list. Uses the existing `releases.list` procedure. */
export function useReleasesList(input: { from: string; to: string }) {
  const query = trpc.releases.list.useQuery({ from: input.from, to: input.to });
  const absent = query.isError && procedureNotFound(query.error);
  const items = query.data ? query.data.items.map(toListItem) : [];
  return {
    isLoading: absent ? false : query.isLoading,
    isPending: absent ? false : query.isPending,
    isFetching: query.isFetching,
    isError: query.isError && !absent,
    error: absent ? null : query.error,
    errorUpdateCount: query.errorUpdateCount,
    dataUpdatedAt: query.dataUpdatedAt,
    refetch: () => {
      void query.refetch();
    },
    data: query.data
      ? { absent: false as const, items }
      : absent
        ? { absent: true as const, items: [] as ReleaseListItem[] }
        : undefined,
  };
}
