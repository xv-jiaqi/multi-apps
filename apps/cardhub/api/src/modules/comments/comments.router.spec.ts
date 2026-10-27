import { APP_ERROR_CODES } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { CommentsRouter } from './comments.router';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';

/**
 * Verifies the read/write split that backs PRD Story 3.4 / 3.5:
 * comments.listForCard is public, comments.create is gated by
 * authedProcedure. The TrpcBase factory is the same one wired into
 * production, so an UNAUTHORIZED context is genuinely rejected by the
 * middleware rather than only by a defensive check inside the procedure.
 */

function makeRouter() {
  const cardFindUnique = jest.fn();
  const seriesFindUnique = jest.fn();
  const commentFindMany = jest.fn();
  const commentCreate = jest.fn();
  const commentFindUnique = jest.fn();
  const commentDelete = jest.fn();
  const userFindUnique = jest.fn();
  const auditCreate = jest.fn();
  const prisma = {
    card: { findUnique: cardFindUnique },
    series: { findUnique: seriesFindUnique },
    comment: {
      findMany: commentFindMany,
      create: commentCreate,
      findUnique: commentFindUnique,
      delete: commentDelete,
    },
    user: { findUnique: userFindUnique },
    auditLog: { create: auditCreate },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  } as unknown as PrismaService;

  const router = new CommentsRouter(new TrpcBase(), prisma);
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
    cardFindUnique,
    seriesFindUnique,
    commentFindMany,
    commentCreate,
    commentFindUnique,
    commentDelete,
    userFindUnique,
    auditCreate,
  };
}

describe('CommentsRouter.listForCard', () => {
  it('is public and returns mapped DTOs ordered by router input', async () => {
    const { caller, cardFindUnique, commentFindMany } = makeRouter();
    cardFindUnique.mockResolvedValueOnce({ id: 'card-1' });
    commentFindMany.mockResolvedValueOnce([
      {
        id: 'cm-1',
        content: 'hi',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        user: { id: 'u1', username: 'alice' },
      },
    ]);

    const result = await caller(null).listForCard({ cardSlug: 'aurora-knight' });
    expect(result).toEqual([
      {
        id: 'cm-1',
        content: 'hi',
        createdAt: '2026-05-01T00:00:00.000Z',
        user: { id: 'u1', username: 'alice' },
      },
    ]);
    expect(commentFindMany.mock.calls[0]?.[0]?.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('returns NOT_FOUND when the card slug is unknown', async () => {
    const { caller, cardFindUnique } = makeRouter();
    cardFindUnique.mockResolvedValueOnce(null);

    await expect(caller(null).listForCard({ cardSlug: 'no-card' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('CommentsRouter.listForSeries', () => {
  it('is public and returns comments for a series target', async () => {
    const { caller, seriesFindUnique, commentFindMany } = makeRouter();
    seriesFindUnique.mockResolvedValueOnce({ id: 'series-1' });
    commentFindMany.mockResolvedValueOnce([
      {
        id: 'cm-series',
        content: 'great set',
        createdAt: new Date('2026-05-02T00:00:00Z'),
        user: { id: 'u1', username: 'alice' },
      },
    ]);

    const result = await caller(null).listForSeries({ seriesSlug: 'sky-dawn' });
    expect(result).toEqual([
      {
        id: 'cm-series',
        content: 'great set',
        createdAt: '2026-05-02T00:00:00.000Z',
        user: { id: 'u1', username: 'alice' },
      },
    ]);
    expect(commentFindMany).toHaveBeenCalledWith({
      where: { seriesId: 'series-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { id: true, username: true } } },
    });
  });

  it('returns NOT_FOUND when the series slug is unknown', async () => {
    const { caller, seriesFindUnique } = makeRouter();
    seriesFindUnique.mockResolvedValueOnce(null);

    await expect(caller(null).listForSeries({ seriesSlug: 'no-series' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('CommentsRouter.create', () => {
  it('rejects anonymous calls via the authedProcedure middleware', async () => {
    const { caller } = makeRouter();
    await expect(
      caller(null).create({ cardSlug: 'aurora-knight', content: 'hi' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
    });
  });

  it('persists the comment with userId resolved from ctx.user.sub', async () => {
    const { caller, cardFindUnique, commentCreate } = makeRouter();
    cardFindUnique.mockResolvedValueOnce({ id: 'card-1' });
    commentCreate.mockResolvedValueOnce({
      id: 'cm-new',
      content: 'great card',
      createdAt: new Date('2026-05-01T00:00:00Z'),
      user: { id: 'u-alice', username: 'alice' },
    });

    const result = await caller({
      sub: 'u-alice',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    }).create({
      cardSlug: 'aurora-knight',
      content: 'great card',
    });

    expect(result).toEqual({
      id: 'cm-new',
      content: 'great card',
      createdAt: '2026-05-01T00:00:00.000Z',
      user: { id: 'u-alice', username: 'alice' },
    });
    const createArgs = commentCreate.mock.calls[0]?.[0]?.data;
    expect(createArgs).toEqual({
      content: 'great card',
      cardId: 'card-1',
      userId: 'u-alice',
    });
  });

  it('returns NOT_FOUND when targeting an unknown card', async () => {
    const { caller, cardFindUnique } = makeRouter();
    cardFindUnique.mockResolvedValueOnce(null);
    await expect(
      caller({
        sub: 'u-alice',
        username: 'alice',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).create({
        cardSlug: 'ghost-card',
        content: 'hi',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('CommentsRouter.createForSeries', () => {
  it('rejects anonymous calls via the authedProcedure middleware', async () => {
    const { caller } = makeRouter();
    await expect(
      caller(null).createForSeries({ seriesSlug: 'sky-dawn', content: 'hi' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('persists the comment against a series target', async () => {
    const { caller, seriesFindUnique, commentCreate } = makeRouter();
    seriesFindUnique.mockResolvedValueOnce({ id: 'series-1' });
    commentCreate.mockResolvedValueOnce({
      id: 'cm-new',
      content: 'great series',
      createdAt: new Date('2026-05-02T00:00:00Z'),
      user: { id: 'u-alice', username: 'alice' },
    });

    const result = await caller({
      sub: 'u-alice',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    }).createForSeries({
      seriesSlug: 'sky-dawn',
      content: 'great series',
    });

    expect(result).toEqual({
      id: 'cm-new',
      content: 'great series',
      createdAt: '2026-05-02T00:00:00.000Z',
      user: { id: 'u-alice', username: 'alice' },
    });
    expect(commentCreate.mock.calls[0]?.[0]?.data).toEqual({
      content: 'great series',
      seriesId: 'series-1',
      userId: 'u-alice',
    });
  });

  it('returns NOT_FOUND when targeting an unknown series', async () => {
    const { caller, seriesFindUnique } = makeRouter();
    seriesFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller({
        sub: 'u-alice',
        username: 'alice',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).createForSeries({
        seriesSlug: 'ghost-series',
        content: 'hi',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('CommentsRouter.delete', () => {
  it('allows the comment author to delete their own comment without an admin lookup', async () => {
    const { caller, commentFindUnique, commentDelete, userFindUnique } = makeRouter();
    commentFindUnique.mockResolvedValueOnce({ id: 'cm-1', userId: 'u-alice' });
    commentDelete.mockResolvedValueOnce({ id: 'cm-1' });

    await expect(
      caller({
        sub: 'u-alice',
        username: 'alice',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).delete({
        id: '11111111-1111-4111-8111-111111111111',
      }),
    ).resolves.toEqual({ ok: true });

    expect(userFindUnique).not.toHaveBeenCalled();
    expect(commentDelete).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111' },
    });
  });

  it('allows an admin to delete another user comment', async () => {
    const { caller, commentFindUnique, commentDelete, userFindUnique } = makeRouter();
    commentFindUnique.mockResolvedValueOnce({
      id: 'cm-1',
      userId: 'u-alice',
      content: 'hi',
    });
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
    commentDelete.mockResolvedValueOnce({ id: 'cm-1' });

    await expect(
      caller({
        sub: 'u-admin',
        username: 'admin',
        role: 'admin',
        tokenVersion: 0,
        bannedAt: null,
      }).delete({
        id: '22222222-2222-4222-8222-222222222222',
      }),
    ).resolves.toEqual({ ok: true });

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 'u-admin' },
      select: { role: true },
    });
    expect(commentDelete).toHaveBeenCalledWith({
      where: { id: '22222222-2222-4222-8222-222222222222' },
    });
  });

  it('rejects a non-admin deleting someone else comment', async () => {
    const { caller, commentFindUnique, commentDelete, userFindUnique } = makeRouter();
    commentFindUnique.mockResolvedValueOnce({ id: 'cm-1', userId: 'u-alice' });
    userFindUnique.mockResolvedValueOnce({ role: 'user' });

    await expect(
      caller({
        sub: 'u-bob',
        username: 'bob',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).delete({
        id: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(commentDelete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the comment is already gone', async () => {
    const { caller, commentFindUnique, commentDelete } = makeRouter();
    commentFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller({
        sub: 'u-alice',
        username: 'alice',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).delete({
        id: '44444444-4444-4444-8444-444444444444',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(commentDelete).not.toHaveBeenCalled();
  });
});
