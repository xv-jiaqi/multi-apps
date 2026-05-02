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
  const commentFindMany = jest.fn();
  const commentCreate = jest.fn();
  const prisma = {
    card: { findUnique: cardFindUnique },
    comment: { findMany: commentFindMany, create: commentCreate },
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

  return { caller, cardFindUnique, commentFindMany, commentCreate };
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

describe('CommentsRouter.create', () => {
  it('rejects anonymous calls via the authedProcedure middleware', async () => {
    const { caller } = makeRouter();
    await expect(
      caller(null).create({ cardSlug: 'aurora-knight', content: 'hi' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
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

    const result = await caller({ sub: 'u-alice', username: 'alice' }).create({
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
      caller({ sub: 'u-alice', username: 'alice' }).create({
        cardSlug: 'ghost-card',
        content: 'hi',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
