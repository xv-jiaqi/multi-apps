import { vi } from 'vitest';

/** Fake tRPC batch endpoint for tests that render the real TrpcProvider. */
export type Requested = { procedures: string[]; inputs: Record<string, unknown> };

export const SERIES = {
  id: 's1',
  slug: 'ptcg-sc-csv10',
  title: '共逐荣光',
  description: null,
  coverUrl: null,
  createdAt: '2026-11-16T04:16:44.615Z',
  updatedAt: '2026-11-16T04:16:44.615Z',
  releaseDate: null,
  category: null,
  subsets: [],
  baseCardCount: 1,
  releases: [],
};

export const LIST = {
  items: [
    {
      id: 'c1',
      slug: 'ptcg-sc-csv10-001',
      name: '阿响的凯罗斯',
      rarity: 'common',
      imageUrl: null,
      cardNumber: '001',
      subsetSlug: null,
      attributes: {},
      parallelName: null,
      printRun: null,
      isParallel: false,
    },
  ],
  page: 1,
  pageSize: 60,
  total: 1,
  seriesTotal: 1,
  parallelCount: 0,
  sort: 'number',
  attributeLabels: {},
};

function parseRequest(input: RequestInfo | URL): Requested {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, 'http://localhost');
  const procedures = url.pathname.replace(/^.*\/trpc\//, '').split(',');
  const batch = JSON.parse(url.searchParams.get('input') ?? '{}') as Record<string, unknown>;
  const inputs: Record<string, unknown> = {};
  procedures.forEach((procedure, index) => {
    inputs[procedure] = batch[String(index)];
  });
  return { procedures, inputs };
}

export function stubApi(answer: (procedure: string) => { data: unknown } | { notFound: true }) {
  const requests: Requested[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const request = parseRequest(input);
      requests.push(request);
      const items = request.procedures.map((procedure) => {
        const result = answer(procedure);
        if ('notFound' in result) {
          return {
            error: {
              message: 'NOT_FOUND',
              code: -32004,
              data: { code: 'NOT_FOUND', httpStatus: 404, path: procedure },
            },
          };
        }
        return { result: { data: result.data } };
      });
      const failed = items.some((item) => 'error' in item);
      return new Response(JSON.stringify(items), {
        status: failed ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return {
    requests,
    count: (procedure: string) => requests.filter((r) => r.procedures.includes(procedure)).length,
  };
}
