import { TrpcBase } from '../../trpc/trpc-base';
import { ReportsRouter } from './reports.router';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';

function makeRouter() {
  const reportCount = jest.fn();
  const reportCreate = jest.fn();
  const reportFindMany = jest.fn();
  const userFindUnique = jest.fn();
  const listingFindUnique = jest.fn();
  const listingFindMany = jest.fn();
  const topicFindUnique = jest.fn();
  const topicFindMany = jest.fn();
  const replyFindUnique = jest.fn();
  const replyFindMany = jest.fn();
  const commentFindUnique = jest.fn();
  const commentFindMany = jest.fn();

  const prisma = {
    report: {
      count: reportCount,
      create: reportCreate,
      findMany: reportFindMany,
    },
    user: { findUnique: userFindUnique },
    listing: { findUnique: listingFindUnique, findMany: listingFindMany },
    topic: { findUnique: topicFindUnique, findMany: topicFindMany },
    reply: { findUnique: replyFindUnique, findMany: replyFindMany },
    comment: { findUnique: commentFindUnique, findMany: commentFindMany },
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
    userFindUnique,
    listingFindUnique,
    listingFindMany,
    topicFindUnique,
    topicFindMany,
    replyFindUnique,
    replyFindMany,
    commentFindUnique,
    commentFindMany,
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
      caller({ sub: 'u1', username: 'alice' }).create({
        targetType: 'COMMENT',
        targetId: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        reason: 'still spam',
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
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

    const result = await caller({ sub: 'u1', username: 'alice' }).create({
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
      caller({ sub: 'u1', username: 'alice' }).create({
        targetType: 'COMMENT',
        targetId: '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5',
        reason: 'already gone',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(reportCreate).not.toHaveBeenCalled();
  });
});

describe('ReportsRouter.list', () => {
  it('rejects non-admin callers with FORBIDDEN', async () => {
    const { caller, userFindUnique } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ role: 'user' });

    await expect(
      caller({ sub: 'u1', username: 'alice' }).list({ limit: 20 }),
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

    const result = await caller({ sub: 'u-admin', username: 'admin' }).list({ limit: 20 });
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
});
