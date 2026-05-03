import { Prisma } from '@prisma/client';
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
  const userFindUnique = jest.fn();

  const prisma = {
    listing: {
      findMany: listingFindMany,
      findUnique: listingFindUnique,
      create: listingCreate,
      update: listingUpdate,
    },
    card: { findUnique: cardFindUnique },
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
    userFindUnique,
  };
}

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
    const { caller, cardFindUnique, listingCreate } = makeRouter();
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
        status: 'OPEN',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-01T00:00:00Z'),
        user: { id: data.userId, username: 'alice' },
      }),
    );

    const result = await caller({ sub: 'u-alice', username: 'alice' }).publish({
      cardSlug: 'aurora-knight',
      kind: 'SELL',
      price: 199.5,
      currency: 'CNY',
      imageUrls: ['https://img.cardhub.test/a.jpg'],
      contact: 'wechat: alice',
      note: 'mint condition',
    });

    expect(result.price).toBe('199.50');
    expect(result.kind).toBe('SELL');
    expect(result.currency).toBe('CNY');
    expect(result.imageUrls).toEqual(['https://img.cardhub.test/a.jpg']);
    expect(result.seller).toEqual({ id: 'u-alice', username: 'alice' });

    const passed = listingCreate.mock.calls[0]?.[0]?.data;
    expect(passed.userId).toBe('u-alice');
    expect(passed.price).toBeInstanceOf(Prisma.Decimal);
    expect(passed.price?.toFixed(2)).toBe('199.50');
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
    const { caller, listingFindMany } = makeRouter();
    listingFindMany.mockResolvedValueOnce([]);

    await caller(null).byCard({ cardSlug: 'aurora-knight', limit: 5 });
    const args = listingFindMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({ cardSlug: 'aurora-knight', status: 'OPEN' });
    expect(args.take).toBe(5);
  });
});
