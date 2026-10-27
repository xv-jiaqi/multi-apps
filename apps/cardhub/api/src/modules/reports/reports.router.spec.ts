import { APP_ERROR_CODES } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { ReportsRouter } from './reports.router';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';

function makeRouter() {
  const reportCount = jest.fn();
  const reportCreate = jest.fn();
  const reportFindMany = jest.fn();
  const reportFindUnique = jest.fn();
  const reportUpdate = jest.fn();
  const reportUpdateMany = jest.fn();
  const userFindUnique = jest.fn();
  const listingFindUnique = jest.fn();
  const listingFindMany = jest.fn();
  const listingUpdate = jest.fn();
  const topicFindUnique = jest.fn();
  const topicFindMany = jest.fn();
  const topicDelete = jest.fn();
  const replyFindUnique = jest.fn();
  const replyFindMany = jest.fn();
  const replyDelete = jest.fn();
  const commentFindUnique = jest.fn();
  const commentFindMany = jest.fn();
  const commentDelete = jest.fn();
  const cardFindMany = jest.fn();

  const prisma = {
    report: {
      count: reportCount,
      create: reportCreate,
      findMany: reportFindMany,
      findUnique: reportFindUnique,
      update: reportUpdate,
      updateMany: reportUpdateMany,
    },
    user: { findUnique: userFindUnique },
    listing: { findUnique: listingFindUnique, findMany: listingFindMany, update: listingUpdate },
    topic: { findUnique: topicFindUnique, findMany: topicFindMany, delete: topicDelete },
    reply: { findUnique: replyFindUnique, findMany: replyFindMany, delete: replyDelete },
    comment: { findUnique: commentFindUnique, findMany: commentFindMany, delete: commentDelete },
    card: { findMany: cardFindMany },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  } as unknown as PrismaService;

  const router = new ReportsRouter(new TrpcBase(), prisma);
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
    reportCount,
    reportCreate,
    reportFindMany,
    reportFindUnique,
    reportUpdate,
    reportUpdateMany,
    userFindUnique,
    listingFindUnique,
    listingFindMany,
    listingUpdate,
    topicFindUnique,
    topicFindMany,
    topicDelete,
    replyFindUnique,
    replyFindMany,
    replyDelete,
    commentFindUnique,
    commentFindMany,
    commentDelete,
    cardFindMany,
  };
}

describe('ReportsRouter.create', () => {
  it('rejects anon callers via authedProcedure', async () => {
    const { caller } = makeRouter();
    await expect(
      caller(null).create({
        targetType: 'TOPIC',
        targetId: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        reason: 'spam content',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('enforces a per-user 10-report-per-day quota', async () => {
    const { caller, reportCount, reportCreate } = makeRouter();
    reportCount.mockResolvedValueOnce(10);

    await expect(
      caller({ sub: 'u1', username: 'alice', role: 'user', tokenVersion: 0 }).create({
        targetType: 'COMMENT',
        targetId: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        reason: 'still spam',
      }),
    ).rejects.toMatchObject({
      code: APP_ERROR_CODES.TOO_MANY_REQUESTS,
      cause: { appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS },
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it('persists the report and returns id + createdAt when under quota', async () => {
    const { caller, reportCount, reportCreate, listingFindUnique } = makeRouter();
    reportCount.mockResolvedValueOnce(2);
    listingFindUnique.mockResolvedValueOnce({ id: 'f3a78b1c-8d4e-4f1a-9b2c-7c8d4e1f5a3b' });
    reportCreate.mockResolvedValueOnce({
      id: 'r-new',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });

    const result = await caller({
      sub: 'u1',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
    }).create({
      targetType: 'LISTING',
      targetId: 'f3a78b1c-8d4e-4f1a-9b2c-7c8d4e1f5a3b',
      reason: 'price obviously fake',
    });

    expect(result).toEqual({
      id: 'r-new',
      createdAt: '2026-05-01T00:00:00.000Z',
    });
    const args = reportCreate.mock.calls[0]?.[0]?.data;
    expect(args.reporterId).toBe('u1');
    expect(args.targetType).toBe('LISTING');
  });

  it('rejects reports that point at deleted targets', async () => {
    const { caller, reportCount, commentFindUnique, reportCreate } = makeRouter();
    reportCount.mockResolvedValueOnce(0);
    commentFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller({ sub: 'u1', username: 'alice', role: 'user', tokenVersion: 0 }).create({
        targetType: 'COMMENT',
        targetId: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        reason: 'already gone',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(reportCreate).not.toHaveBeenCalled();
  });
});

describe('ReportsRouter.resolve', () => {
  it('rejects non-admin callers with FORBIDDEN', async () => {
    const { caller, userFindUnique, reportUpdate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u1', role: 'user' });

    await expect(
      caller({ sub: 'u1', username: 'alice', role: 'user', tokenVersion: 0 }).resolve({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        action: 'MARK_RESOLVED',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(reportUpdate).not.toHaveBeenCalled();
  });

  it('lets an admin mark a pending report as resolved', async () => {
    const { caller, userFindUnique, reportFindUnique, reportUpdate } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    reportFindUnique.mockResolvedValueOnce({
      id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
      status: 'PENDING',
      targetType: 'COMMENT',
      targetId: 'target-1',
    });
    reportUpdate.mockResolvedValueOnce({});

    await expect(
      caller({ sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0 }).resolve({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        action: 'MARK_RESOLVED',
        resolution: ' handled ',
      }),
    ).resolves.toEqual({ ok: true });

    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolvedById: 'u-admin',
        resolution: 'handled',
      }),
    });
  });

  it('returns NOT_FOUND when the report id does not exist', async () => {
    const { caller, userFindUnique, reportFindUnique, reportUpdate, reportUpdateMany } =
      makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    reportFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller({ sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0 }).resolve({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        action: 'MARK_RESOLVED',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(reportUpdate).not.toHaveBeenCalled();
    expect(reportUpdateMany).not.toHaveBeenCalled();
  });

  it('marks resolved even when the reported target no longer exists', async () => {
    const { caller, userFindUnique, reportFindUnique, reportUpdate, commentFindUnique } =
      makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    reportFindUnique.mockResolvedValueOnce({
      id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
      status: 'PENDING',
      targetType: 'COMMENT',
      targetId: 'target-1',
    });
    reportUpdate.mockResolvedValueOnce({});
    commentFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller({ sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0 }).resolve({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        action: 'MARK_RESOLVED',
      }),
    ).resolves.toEqual({ ok: true });
    expect(commentFindUnique).toHaveBeenCalled();
    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolvedById: 'u-admin',
      }),
    });
  });

  it('rejects invalid resolve input before touching the database', async () => {
    const { caller, userFindUnique, reportFindUnique } = makeRouter();

    await expect(
      caller({ sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0 }).resolve({
        id: 'not-a-uuid',
        action: 'MARK_RESOLVED',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(reportFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['LISTING', 'listingUpdate'],
    ['TOPIC', 'topicDelete'],
    ['REPLY', 'replyDelete'],
    ['COMMENT', 'commentDelete'],
  ] as const)(
    'removes or closes %s targets and resolves sibling pending reports',
    async (targetType, actionMock) => {
      const router = makeRouter();
      router.userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
      router.reportFindUnique.mockResolvedValueOnce({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        status: 'PENDING',
        targetType,
        targetId: 'target-1',
      });
      router.listingFindUnique.mockResolvedValueOnce({ id: 'target-1' });
      router.topicFindUnique.mockResolvedValueOnce({ id: 'target-1' });
      router.replyFindUnique.mockResolvedValueOnce({ id: 'target-1' });
      router.commentFindUnique.mockResolvedValueOnce({ id: 'target-1' });
      router.listingUpdate.mockResolvedValueOnce({});
      router.topicDelete.mockResolvedValueOnce({});
      router.replyDelete.mockResolvedValueOnce({});
      router.commentDelete.mockResolvedValueOnce({});
      router.reportUpdateMany.mockResolvedValueOnce({ count: 2 });

      await expect(
        router
          .caller({ sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0 })
          .resolve({
            id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
            action: 'REMOVE_TARGET',
            resolution: 'confirmed',
          }),
      ).resolves.toEqual({ ok: true });

      expect(router[actionMock]).toHaveBeenCalled();
      expect(router.reportUpdateMany).toHaveBeenCalledWith({
        where: { targetType, targetId: 'target-1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedById: 'u-admin',
          resolution: 'confirmed',
        }),
      });
    },
  );

  it('returns NOT_FOUND for REMOVE_TARGET when the target no longer exists', async () => {
    const { caller, userFindUnique, reportFindUnique, commentFindUnique, reportUpdateMany } =
      makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    reportFindUnique.mockResolvedValueOnce({
      id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
      status: 'PENDING',
      targetType: 'COMMENT',
      targetId: 'target-1',
    });
    commentFindUnique.mockResolvedValueOnce(null);

    await expect(
      caller({ sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0 }).resolve({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        action: 'REMOVE_TARGET',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(reportUpdateMany).not.toHaveBeenCalled();
  });

  it('treats already resolved reports as idempotent no-ops', async () => {
    const { caller, userFindUnique, reportFindUnique, reportUpdate, reportUpdateMany } =
      makeRouter();
    userFindUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'admin' });
    reportFindUnique.mockResolvedValueOnce({
      id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
      status: 'RESOLVED',
      targetType: 'COMMENT',
      targetId: 'target-1',
    });

    await expect(
      caller({ sub: 'u-admin', username: 'admin', role: 'admin', tokenVersion: 0 }).resolve({
        id: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        action: 'REMOVE_TARGET',
      }),
    ).resolves.toEqual({ ok: true });
    expect(reportUpdate).not.toHaveBeenCalled();
    expect(reportUpdateMany).not.toHaveBeenCalled();
  });
});

describe('ReportsRouter.list', () => {
  it('rejects non-admin callers with FORBIDDEN', async () => {
    const { caller, userFindUnique } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ role: 'user' });

    await expect(
      caller({ sub: 'u1', username: 'alice', role: 'user', tokenVersion: 0 }).list({ limit: 20 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns paginated rows for admin with cursor support + target context', async () => {
    const { caller, userFindUnique, reportFindMany, topicFindMany } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
    reportFindMany.mockResolvedValueOnce([
      {
        id: 'r1',
        targetType: 'TOPIC',
        targetId: 't1',
        reason: 'r1',
        status: 'PENDING',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        reporter: { id: 'u1', username: 'alice' },
      },
    ]);
    topicFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        slug: 'market-watch-abc123',
        title: 'Market watch',
        user: { username: 'bob' },
      },
    ]);

    const result = await caller({
      sub: 'u-admin',
      username: 'admin',
      role: 'admin',
      tokenVersion: 0,
    }).list({ limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'r1',
      targetType: 'TOPIC',
      reason: 'r1',
      status: 'PENDING',
      target: {
        slug: 'market-watch-abc123',
        title: 'Market watch',
        authorUsername: 'bob',
      },
    });
    expect(result.nextCursor).toBeNull();
  });

  it('adds optional cardName to listing target context', async () => {
    const { caller, userFindUnique, reportFindMany, listingFindMany, cardFindMany } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
    reportFindMany.mockResolvedValueOnce([
      {
        id: 'r-listing',
        targetType: 'LISTING',
        targetId: 'listing-1',
        reason: 'fake listing',
        status: 'PENDING',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        reporter: { id: 'u1', username: 'alice' },
      },
    ]);
    listingFindMany.mockResolvedValueOnce([
      {
        id: 'listing-1',
        cardSlug: 'forge-titan',
        status: 'OPEN',
        user: { username: 'seller' },
      },
    ]);
    cardFindMany.mockResolvedValueOnce([{ slug: 'forge-titan', name: 'Forge Titan' }]);

    const result = await caller({
      sub: 'u-admin',
      username: 'admin',
      role: 'admin',
      tokenVersion: 0,
    }).list({ limit: 20 });

    expect(cardFindMany).toHaveBeenCalledWith({
      where: { slug: { in: ['forge-titan'] } },
      select: { slug: true, name: true },
    });
    expect(result.items[0]?.target).toMatchObject({
      cardSlug: 'forge-titan',
      cardName: 'Forge Titan',
      status: 'OPEN',
      sellerUsername: 'seller',
    });
  });

  it('returns series context for reports on series comments', async () => {
    const { caller, userFindUnique, reportFindMany, commentFindMany } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
    reportFindMany.mockResolvedValueOnce([
      {
        id: 'r-series-comment',
        targetType: 'COMMENT',
        targetId: 'cm-series',
        reason: 'off topic',
        status: 'PENDING',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        reporter: { id: 'u1', username: 'alice' },
      },
    ]);
    commentFindMany.mockResolvedValueOnce([
      {
        id: 'cm-series',
        content: 'series comment body',
        user: { username: 'bob' },
        card: null,
        series: { slug: 'sky-dawn', title: '天穹黎明' },
      },
    ]);

    const result = await caller({
      sub: 'u-admin',
      username: 'admin',
      role: 'admin',
      tokenVersion: 0,
    }).list({ limit: 20 });

    expect(result.items[0]).toMatchObject({
      targetType: 'COMMENT',
      target: {
        cardSlug: null,
        cardName: null,
        seriesSlug: 'sky-dawn',
        seriesTitle: '天穹黎明',
        authorUsername: 'bob',
        excerpt: 'series comment body',
      },
    });
  });
});
