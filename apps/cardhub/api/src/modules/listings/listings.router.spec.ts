import { Decimal } from '@prisma/client/runtime/library';
import { listingPublishInput } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { ListingsRouter } from './listings.router';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';

/**
 * Unit-tests for ListingsRouter. Mirrors the comments / forum spec setup —
 * mock prisma, drive the real authedProcedure middleware, assert behaviour
 * around publish validation, ownership on close and the soft cardSlug
 * pointer.
 */

function makeRouter() {
  const listingFindMany = jest.fn();
  const listingFindUnique = jest.fn();
  const listingCreate = jest.fn();
  const listingUpdate = jest.fn();
  const cardFindUnique = jest.fn();
  const cardFindMany = jest.fn();
  const userFindUnique = jest.fn();

  const prisma = {
    listing: {
      findMany: listingFindMany,
      findUnique: listingFindUnique,
      create: listingCreate,
      update: listingUpdate,
    },
    card: { findUnique: cardFindUnique, findMany: cardFindMany },
    user: { findUnique: userFindUnique },
  } as unknown as PrismaService;

  const router = new ListingsRouter(new TrpcBase(), prisma);
  const built = router.build();

  function caller(user: TrpcContext['user']) {
    return built.createCaller({
      req: {} as never,
      res: {} as never,
      user,
    });
  }

  return {
    caller,
    listingFindMany,
    listingFindUnique,
    listingCreate,
    listingUpdate,
    cardFindUnique,
    cardFindMany,
    userFindUnique,
  };
}

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    userId: 'u-alice',
    cardSlug: 'aurora-knight',
    kind: 'SELL',
    price: new Decimal('12.00'),
    currency: 'CNY',
    imageUrls: [],
    contact: 'wechat: alice',
    note: null,
    condition: null,
    language: null,
    variantNote: null,
    status: 'OPEN',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    user: { id: 'u-alice', username: 'alice' },
    ...overrides,
  };
}

describe('listing image URL schema', () => {
  it('requires https image URLs and an uppercase ISO currency code', () => {
    expect(
      listingPublishInput.safeParse({
        cardSlug: 'aurora-knight',
        kind: 'SELL',
        currency: 'CNY',
        imageUrls: ['http://img.cardhub.test/a.jpg'],
        contact: 'wechat: alice',
      }).success,
    ).toBe(false);

    const parsed = listingPublishInput.safeParse({
      cardSlug: 'aurora-knight',
      kind: 'SELL',
      currency: 'cny',
      imageUrls: ['https://img.cardhub.test/a.jpg'],
      contact: 'wechat: alice',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.currency).toBe('CNY');

    expect(
      listingPublishInput.safeParse({
        cardSlug: 'aurora-knight',
        kind: 'SELL',
        currency: '元',
        imageUrls: [],
        contact: 'wechat: alice',
      }).success,
    ).toBe(false);
  });
});

describe('ListingsRouter.publish', () => {
  it('rejects when the cardSlug does not exist', async () => {
    const { caller, cardFindUnique } = makeRouter();
    cardFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller({ sub: 'u1', username: 'alice' }).publish({
        cardSlug: 'no-such-card',
        kind: 'SELL',
        price: 100,
        currency: 'CNY',
        imageUrls: [],
        contact: 'wechat: alice',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('persists Decimal-stringified price + flattens to seller', async () => {
    const { caller, cardFindUnique, cardFindMany, listingCreate } = makeRouter();
    cardFindUnique.mockResolvedValueOnce({ id: 'card-1' });
    listingCreate.mockImplementationOnce(({ data, include: _include }) =>
      Promise.resolve({
        id: 'l-new',
        userId: data.userId,
        cardSlug: data.cardSlug,
        kind: data.kind,
        price: data.price,
        currency: data.currency,
        imageUrls: data.imageUrls,
        contact: data.contact,
        note: data.note,
        condition: data.condition,
        language: data.language,
        variantNote: data.variantNote,
        status: 'OPEN',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-01T00:00:00Z'),
        user: { id: data.userId, username: 'alice' },
      }),
    );
    cardFindMany.mockResolvedValueOnce([
      {
        slug: 'aurora-knight',
        name: 'Aurora Knight',
        imageUrl: 'https://img.cardhub.test/card.jpg',
        series: { slug: 'starter', title: 'Starter' },
      },
    ]);

    const result = await caller({ sub: 'u-alice', username: 'alice' }).publish({
      cardSlug: 'aurora-knight',
      kind: 'SELL',
      price: 199.5,
      currency: 'CNY',
      imageUrls: ['https://img.cardhub.test/a.jpg'],
      contact: 'wechat: alice',
      note: 'mint condition',
      condition: 'NEAR_MINT',
      language: 'ZH',
      variantNote: 'foil',
    });

    expect(result.price).toBe('199.50');
    expect(result.kind).toBe('SELL');
    expect(result.currency).toBe('CNY');
    expect(result.imageUrls).toEqual(['https://img.cardhub.test/a.jpg']);
    expect(result.condition).toBe('NEAR_MINT');
    expect(result.language).toBe('ZH');
    expect(result.variantNote).toBe('foil');
    expect(result.card).toEqual({
      slug: 'aurora-knight',
      name: 'Aurora Knight',
      imageUrl: 'https://img.cardhub.test/card.jpg',
      seriesSlug: 'starter',
      seriesTitle: 'Starter',
    });
    expect(result.seller).toEqual({ id: 'u-alice', username: 'alice' });

    const passed = listingCreate.mock.calls[0]?.[0]?.data;
    expect(passed.userId).toBe('u-alice');
    expect(passed.price).toBeInstanceOf(Decimal);
    expect(passed.price?.toFixed(2)).toBe('199.50');
    expect(passed.condition).toBe('NEAR_MINT');
  });

  it('rejects http image URLs before writing', async () => {
    const { caller, cardFindUnique, listingCreate } = makeRouter();

    await expect(
      caller({ sub: 'u-alice', username: 'alice' }).publish({
        cardSlug: 'aurora-knight',
        kind: 'SELL',
        currency: 'CNY',
        imageUrls: ['http://img.cardhub.test/a.jpg'],
        contact: 'wechat: alice',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(cardFindUnique).not.toHaveBeenCalled();
    expect(listingCreate).not.toHaveBeenCalled();
  });

  it('rejects anon callers via authedProcedure', async () => {
    const { caller } = makeRouter();
    await expect(
      caller(null).publish({
        cardSlug: 'aurora-knight',
        kind: 'BUY',
        currency: 'CNY',
        imageUrls: [],
        contact: 'qq: 12345',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('ListingsRouter.list', () => {
  it('requires currency for price ranges or price sorting', async () => {
    const { caller } = makeRouter();

    await expect(caller(null).list({ limit: 20, minPrice: 10 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller(null).list({ limit: 20, sort: 'price_asc' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('filters by currency alone without a price range or price sort', async () => {
    const { caller, listingFindMany, cardFindMany } = makeRouter();
    listingFindMany.mockResolvedValueOnce([listingRow()]);
    cardFindMany.mockResolvedValueOnce([]);

    await caller(null).list({ limit: 20, currency: 'CNY', sort: 'newest' });

    const args = listingFindMany.mock.calls[0]?.[0];
    expect(args.where.currency).toBe('CNY');
    expect(args.where.price).toBeUndefined();
    expect(args.orderBy[0]).toEqual({ createdAt: 'desc' });
  });

  it('filters price ranges to the selected currency and non-null prices', async () => {
    const { caller, listingFindMany, cardFindMany } = makeRouter();
    listingFindMany.mockResolvedValueOnce([listingRow()]);
    cardFindMany.mockResolvedValueOnce([]);

    await caller(null).list({
      limit: 20,
      minPrice: 10,
      maxPrice: 20,
      currency: 'CNY',
      sort: 'price_asc',
    });

    const args = listingFindMany.mock.calls[0]?.[0];
    expect(args.where.currency).toBe('CNY');
    expect(args.where.price.not).toBeNull();
    expect(args.where.price.gte).toBeInstanceOf(Decimal);
    expect(args.where.price.lte).toBeInstanceOf(Decimal);
    expect(args.orderBy[0]).toEqual({ price: 'asc' });
  });

  it('keeps legacy free-text currencies in newest sorting', async () => {
    const { caller, listingFindMany, cardFindMany } = makeRouter();
    listingFindMany.mockResolvedValueOnce([
      listingRow({ id: 'legacy', currency: '元', price: new Decimal('12.00') }),
    ]);
    cardFindMany.mockResolvedValueOnce([]);

    const result = await caller(null).list({ limit: 20, sort: 'newest' });

    const args = listingFindMany.mock.calls[0]?.[0];
    expect(args.where.currency).toBeUndefined();
    expect(args.where.price).toBeUndefined();
    expect(result.items[0]?.currency).toBe('元');
  });

  it('supports condition and language filters', async () => {
    const { caller, listingFindMany, cardFindMany } = makeRouter();
    listingFindMany.mockResolvedValueOnce([]);
    cardFindMany.mockResolvedValueOnce([]);

    await caller(null).list({
      limit: 20,
      condition: 'NEAR_MINT',
      language: 'ZH',
    });

    const args = listingFindMany.mock.calls[0]?.[0];
    expect(args.where.condition).toBe('NEAR_MINT');
    expect(args.where.language).toBe('ZH');
  });
});

describe('ListingsRouter.close', () => {
  it('rejects when the requester is neither owner nor admin', async () => {
    const { caller, listingFindUnique, userFindUnique } = makeRouter();
    listingFindUnique.mockResolvedValueOnce({
      id: 'l1',
      userId: 'u-owner',
      status: 'OPEN',
    });
    userFindUnique.mockResolvedValueOnce({ role: 'user' });

    await expect(
      caller({ sub: 'u-other', username: 'other' }).close({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets the owner close their own listing without re-fetching role', async () => {
    const { caller, listingFindUnique, listingUpdate, userFindUnique } = makeRouter();
    listingFindUnique.mockResolvedValueOnce({
      id: 'l1',
      userId: 'u-alice',
      status: 'OPEN',
    });
    listingUpdate.mockResolvedValueOnce({ id: 'l1', status: 'CLOSED' });

    const result = await caller({ sub: 'u-alice', username: 'alice' }).close({
      id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
    });
    expect(result).toEqual({ ok: true });
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(listingUpdate.mock.calls[0]?.[0]?.data).toEqual({ status: 'CLOSED' });
  });

  it('admin can close any listing', async () => {
    const { caller, listingFindUnique, listingUpdate, userFindUnique } = makeRouter();
    listingFindUnique.mockResolvedValueOnce({
      id: 'l1',
      userId: 'u-stranger',
      status: 'OPEN',
    });
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
    listingUpdate.mockResolvedValueOnce({ id: 'l1', status: 'CLOSED' });

    const result = await caller({ sub: 'u-admin', username: 'admin' }).close({
      id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
    });
    expect(result).toEqual({ ok: true });
    expect(listingUpdate).toHaveBeenCalledTimes(1);
  });

  it('returns ok without writing when listing is already CLOSED', async () => {
    const { caller, listingFindUnique, listingUpdate } = makeRouter();
    listingFindUnique.mockResolvedValueOnce({
      id: 'l1',
      userId: 'u-alice',
      status: 'CLOSED',
    });

    const result = await caller({ sub: 'u-alice', username: 'alice' }).close({
      id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
    });
    expect(result).toEqual({ ok: true });
    expect(listingUpdate).not.toHaveBeenCalled();
  });
});

describe('ListingsRouter.byCard', () => {
  it('only surfaces OPEN listings, ordered by recency', async () => {
    const { caller, listingFindMany, cardFindMany } = makeRouter();
    listingFindMany.mockResolvedValueOnce([]);
    cardFindMany.mockResolvedValueOnce([]);

    await caller(null).byCard({ cardSlug: 'aurora-knight', limit: 5 });
    const args = listingFindMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({ cardSlug: 'aurora-knight', status: 'OPEN' });
    expect(args.take).toBe(5);
  });
});
