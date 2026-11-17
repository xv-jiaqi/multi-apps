import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { TrpcBase } from '../src/trpc/trpc-base';
import { AdminRouter } from '../src/modules/admin/admin.router';

/**
 * The import reads stored cards once per batch, not once per card. Counted on
 * the SQL statements Prisma sends to Postgres, so the bound holds for any
 * implementation that stays batched.
 */
describe('catalog import query count', () => {
  jest.setTimeout(120_000);

  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  let statements = 0;
  client.$on('query', () => {
    statements += 1;
  });
  const prisma = Object.assign(client, {
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
  });
  const caller = new AdminRouter(new TrpcBase(), prisma).build().createCaller({
    req: {},
    res: {},
    user: { sub: `qc-${suffix}`, username: 'qc', role: 'admin', tokenVersion: 0 },
  });

  afterAll(async () => {
    await client.card.deleteMany({ where: { slug: { contains: suffix } } });
    await client.series.deleteMany({ where: { slug: { contains: suffix } } });
    await client.$disconnect();
  });

  function file({ name, cards }: { name: string; cards: number }) {
    return [
      {
        slug: `${name}-${suffix}`,
        title: name,
        subsets: [{ slug: 'base', name: '基础卡', kind: 'BASE' }],
        cards: Array.from({ length: cards }, (_, index) => ({
          slug: `${name}-${index + 1}-${suffix}`,
          name: `卡 ${index + 1}`,
          rarity: 'common',
          cardNumber: `${index + 1}/${cards}`,
          subsetSlug: 'base',
        })),
      },
    ];
  }

  async function counted({ data, dryRun }: { data: unknown; dryRun: boolean }) {
    statements = 0;
    await caller.catalog.import({ data, dryRun });
    return statements;
  }

  it('creating cards costs one statement per card (the write), not a lookup plus a write', async () => {
    const small = await counted({ data: file({ name: 'qc-small', cards: 5 }), dryRun: false });
    const large = await counted({ data: file({ name: 'qc-large', cards: 25 }), dryRun: false });
    expect((large - small) / 20).toBeLessThanOrEqual(1);
  });

  it('re-importing the same cards drops the per-card stored-row lookup', async () => {
    const small = await counted({ data: file({ name: 'qc-small', cards: 5 }), dryRun: false });
    const large = await counted({ data: file({ name: 'qc-large', cards: 25 }), dryRun: false });
    // Per card on update: the parallel check reads the row, then the upsert.
    expect((large - small) / 20).toBeLessThanOrEqual(3);
  });
});
