import { TrpcBase } from '../../trpc/trpc-base';
import { UsersRouter } from './users.router';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';

function makeRouter() {
  const userFindUnique = jest.fn();
  const listingCount = jest.fn();
  const topicCount = jest.fn();
  const replyCount = jest.fn();
  const commentCount = jest.fn();
  const topicFindMany = jest.fn();
  const commentFindMany = jest.fn();

  const prisma = {
    user: { findUnique: userFindUnique },
    listing: { count: listingCount },
    topic: { count: topicCount, findMany: topicFindMany },
    reply: { count: replyCount },
    comment: { count: commentCount, findMany: commentFindMany },
  } as unknown as PrismaService;

  const router = new UsersRouter(new TrpcBase(), prisma);
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
    userFindUnique,
    listingCount,
    topicCount,
    replyCount,
    commentCount,
    topicFindMany,
    commentFindMany,
  };
}

describe('UsersRouter.me', () => {
  it('rejects anonymous callers', async () => {
    const { caller } = makeRouter();
    await expect(caller(null).me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns listingTotalCount including closed listings while preserving open listingCount', async () => {
    const { caller, userFindUnique, listingCount, topicCount, replyCount, commentCount } =
      makeRouter();
    userFindUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'alice@cardhub.test',
      username: 'alice',
      role: 'user',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    listingCount.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    topicCount.mockResolvedValueOnce(3);
    replyCount.mockResolvedValueOnce(7);
    commentCount.mockResolvedValueOnce(11);

    const result = await caller({
      sub: 'u1',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    }).me();

    expect(result.listingCount).toBe(2);
    expect(result.listingTotalCount).toBe(5);
    expect(result.topicCount).toBe(3);
    expect(result.replyCount).toBe(7);
    expect(result.commentCount).toBe(11);
    expect(listingCount.mock.calls[0]?.[0]).toEqual({ where: { userId: 'u1', status: 'OPEN' } });
    expect(listingCount.mock.calls[1]?.[0]).toEqual({ where: { userId: 'u1' } });
  });
});

describe('UsersRouter.myTopics', () => {
  it('returns slug/title/replyCount/createdAt using Prisma _count', async () => {
    const { caller, topicFindMany } = makeRouter();
    topicFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        slug: 'hello-world',
        title: 'Hello world',
        createdAt: new Date('2026-05-02T00:00:00Z'),
        _count: { replies: 4 },
      },
    ]);

    const result = await caller({
      sub: 'u1',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    }).myTopics({ limit: 10 });

    expect(result).toEqual({
      items: [
        {
          id: 't1',
          slug: 'hello-world',
          title: 'Hello world',
          replyCount: 4,
          createdAt: '2026-05-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    expect(topicFindMany.mock.calls[0]?.[0]?.include).toEqual({
      _count: { select: { replies: true } },
    });
  });
});

describe('UsersRouter.myComments', () => {
  it('returns card imageUrl in the same query payload', async () => {
    const { caller, commentFindMany } = makeRouter();
    commentFindMany.mockResolvedValueOnce([
      {
        id: 'c1',
        content: 'Great card',
        createdAt: new Date('2026-05-03T00:00:00Z'),
        card: {
          slug: 'aurora-knight',
          name: 'Aurora Knight',
          imageUrl: 'https://img.cardhub.test/aurora.jpg',
        },
      },
    ]);

    const result = await caller({
      sub: 'u1',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    }).myComments({ limit: 10 });

    expect(result.items[0]).toEqual({
      id: 'c1',
      body: 'Great card',
      createdAt: '2026-05-03T00:00:00.000Z',
      cardSlug: 'aurora-knight',
      cardName: 'Aurora Knight',
      cardImageUrl: 'https://img.cardhub.test/aurora.jpg',
      target: {
        kind: 'card',
        slug: 'aurora-knight',
        name: 'Aurora Knight',
        imageUrl: 'https://img.cardhub.test/aurora.jpg',
      },
    });
    expect(commentFindMany.mock.calls[0]?.[0]?.include).toEqual({
      card: { select: { slug: true, name: true, imageUrl: true } },
      series: { select: { slug: true, title: true } },
    });
  });

  it('returns a series target when the comment is not attached to a card', async () => {
    const { caller, commentFindMany } = makeRouter();
    commentFindMany.mockResolvedValueOnce([
      {
        id: 'c-series',
        content: 'Great series',
        createdAt: new Date('2026-05-04T00:00:00Z'),
        card: null,
        series: { slug: 'sky-dawn', title: '天穹黎明' },
      },
    ]);

    const result = await caller({
      sub: 'u1',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    }).myComments({ limit: 10 });

    expect(result.items[0]).toEqual({
      id: 'c-series',
      body: 'Great series',
      createdAt: '2026-05-04T00:00:00.000Z',
      cardSlug: null,
      cardName: null,
      cardImageUrl: null,
      target: { kind: 'series', slug: 'sky-dawn', title: '天穹黎明' },
    });
  });
});
