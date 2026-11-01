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

export type ReleasesLoad =
  | { absent: true; items: [] }
  | { absent: false; items: ReleaseListItem[] };

export class ReleasesRequestError extends Error {
  readonly kind: 'network' | 'http' | 'parse' | 'shape';

  constructor(kind: 'network' | 'http' | 'parse' | 'shape') {
    super(kind);
    this.name = 'ReleasesRequestError';
    this.kind = kind;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRegion(value: unknown): value is ReleaseRegion {
  return value === 'CN' || value === 'JP' || value === 'GLOBAL';
}

function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return undefined;
}

function errorCode(body: unknown): string | undefined {
  const data = isRecord(body) && isRecord(body.error) ? body.error.data : undefined;
  if (!isRecord(data)) return undefined;
  return typeof data.code === 'string' ? data.code : undefined;
}

function isAbsent(status: number, body: unknown): boolean {
  if (status >= 500) return false;
  if (status === 404) return true;
  return errorCode(body) === 'NOT_FOUND';
}

function parseSeries(value: unknown): ReleaseListItem['series'] | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  if (typeof value.slug !== 'string' || typeof value.title !== 'string') return undefined;
  const coverUrl = optionalText(value.coverUrl);
  if (coverUrl === undefined) return undefined;
  return { slug: value.slug, title: value.title, coverUrl };
}

function parseCategory(value: unknown): ReleaseListItem['category'] | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  if (typeof value.slug !== 'string' || typeof value.name !== 'string') return undefined;
  return { slug: value.slug, name: value.name };
}

function parseItem(value: unknown): ReleaseListItem | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return undefined;
  if (typeof value.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.releaseDate)) {
    return undefined;
  }
  const region = value.region === null || value.region === undefined ? null : value.region;
  if (region !== null && !isRegion(region)) return undefined;
  const note = optionalText(value.note);
  const sourceUrl = optionalText(value.sourceUrl);
  const series = parseSeries(value.series);
  const category = parseCategory(value.category);
  if (
    note === undefined ||
    sourceUrl === undefined ||
    series === undefined ||
    category === undefined
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    releaseDate: value.releaseDate,
    region,
    note,
    sourceUrl,
    series,
    category,
  };
}

function readItems(body: unknown): unknown[] | undefined {
  const data = isRecord(body) && isRecord(body.result) ? body.result.data : undefined;
  if (Array.isArray(data)) return data;
  if (!isRecord(data) || !Array.isArray(data.items)) return undefined;
  return data.items;
}

/** Map a tRPC HTTP response. `NOT_FOUND` means the procedure is not on this server. */
export function interpretReleasesResponse(status: number, body: unknown): ReleasesLoad {
  if (isAbsent(status, body)) return { absent: true, items: [] };
  if (status < 200 || status >= 300) throw new ReleasesRequestError('http');
  const rawItems = readItems(body);
  if (!rawItems) throw new ReleasesRequestError('shape');
  const items: ReleaseListItem[] = [];
  for (const raw of rawItems) {
    const item = parseItem(raw);
    if (item) items.push(item);
  }
  return { absent: false, items };
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
