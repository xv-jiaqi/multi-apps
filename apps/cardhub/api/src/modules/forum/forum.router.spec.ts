import { TrpcBase } from '../../trpc/trpc-base';
import { ForumRouter } from './forum.router';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrpcContext } from '../../trpc/context';

/**
 * Verifies the M6 forum router invariants the rest of the system depends on:
 *   1. cursor pagination returns nextCursor only when there are more rows
 *   2. authedProcedure middleware really gates topics.create against anon
 *   3. the 5-minute edit window is enforced
 *   4. admins can delete any topic, ordinary users cannot
 *
 * The Prisma layer is mocked so the suite stays a pure unit test —
 * full e2e coverage lives in the supertest integration spec.
 */
function makeRouter() {
  const topicFindMany = jest.fn();
  const topicFindUnique = jest.fn();
  const topicCreate = jest.fn();
  const topicUpdate = jest.fn();
  const topicDelete = jest.fn();
  const replyFindMany = jest.fn();
  const replyFindUnique = jest.fn();
  const replyCreate = jest.fn();
  const replyDelete = jest.fn();
  const userFindUnique = jest.fn();

  const prisma = {
    topic: {
      findMany: topicFindMany,
      findUnique: topicFindUnique,
      create: topicCreate,
      update: topicUpdate,
      delete: topicDelete,
    },
    reply: {
      findMany: replyFindMany,
      findUnique: replyFindUnique,
      create: replyCreate,
      delete: replyDelete,
    },
    user: { findUnique: userFindUnique },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  } as unknown as PrismaService;

  const router = new ForumRouter(new TrpcBase(), prisma);
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
    topicFindMany,
    topicFindUnique,
    topicCreate,
    topicUpdate,
    topicDelete,
    replyFindMany,
    replyFindUnique,
    replyCreate,
    replyDelete,
    userFindUnique,
  };
}

function makeTopicRow(
  overrides: Partial<{
    id: string;
    slug: string;
    title: string;
    body: string;
    pinned: boolean;
    editedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    username: string;
    replyCount: number;
  }> = {},
) {
  const id = overrides.id ?? 'topic-1';
  const username = overrides.username ?? 'alice';
  return {
    id,
    slug: overrides.slug ?? `${overrides.title ?? 'topic'}-${id}`,
    title: overrides.title ?? 'sample',
    body: overrides.body ?? 'body',
    pinned: overrides.pinned ?? false,
    editedAt: overrides.editedAt ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-05-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-05-01T00:00:00Z'),
    userId: overrides.userId ?? 'u-alice',
    user: { id: overrides.userId ?? 'u-alice', username },
    _count: { replies: overrides.replyCount ?? 0 },
  };
}

describe('ForumRouter.topics.list', () => {
  it('rejects a cursor longer than a uuid', async () => {
    const { caller, topicFindMany } = makeRouter();

    await expect(caller(null).topics.list({ cursor: 'x'.repeat(37) })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    expect(topicFindMany).not.toHaveBeenCalled();
  });

  it('returns nextCursor only when more rows exist beyond the limit', async () => {
    const { caller, topicFindMany } = makeRouter();
    // 3 rows when limit=2 → hasMore=true, nextCursor=last-of-page id.
    topicFindMany.mockResolvedValueOnce([
      makeTopicRow({ id: 't1' }),
      makeTopicRow({ id: 't2' }),
      makeTopicRow({ id: 't3' }),
    ]);

    const page = await caller(null).topics.list({ limit: 2 });
    expect(page.items.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(page.items[0]?.excerpt).toBe('body');
    expect(page.nextCursor).toBe('t2');

    // Now: only 1 row when limit=2 → no more pages.
    topicFindMany.mockResolvedValueOnce([makeTopicRow({ id: 't4' })]);
    const tail = await caller(null).topics.list({ limit: 2, cursor: 't2' });
    expect(tail.items).toHaveLength(1);
    expect(tail.nextCursor).toBeNull();
    // Cursor argument is forwarded to Prisma with skip:1 so the cursor row
    // itself isn't returned twice.
    const cursorArg = topicFindMany.mock.calls[1]?.[0];
    expect(cursorArg?.cursor).toEqual({ id: 't2' });
    expect(cursorArg?.skip).toBe(1);
    expect(cursorArg?.orderBy).toEqual([{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('returns a plain-text excerpt computed from Markdown body', async () => {
    const { caller, topicFindMany } = makeRouter();
    topicFindMany.mockResolvedValueOnce([
      makeTopicRow({
        body: '# Heading\n![alt](https://example.com/a.png)\nRead [docs](https://example.com).',
      }),
    ]);

    const page = await caller(null).topics.list({ limit: 20 });

    expect(page.items[0]?.excerpt).toBe('Heading Read docs.');
    expect(page.items[0]?.body).toContain('![alt]');
  });
});

describe('ForumRouter.topics.bySlug', () => {
  it('returns serverNow and editableUntil for client clock correction', async () => {
    const { caller, topicFindUnique, replyFindMany } = makeRouter();
    topicFindUnique.mockResolvedValueOnce(
      makeTopicRow({ createdAt: new Date('2026-05-01T00:00:00Z') }),
    );
    replyFindMany.mockResolvedValueOnce([]);

    const topic = await caller(null).topics.bySlug({ slug: 'sample-topic' });

    expect(topic.editableUntil).toBe('2026-05-01T00:05:00.000Z');
    expect(Date.parse(topic.serverNow)).not.toBeNaN();
  });
});

describe('ForumRouter.topics.create', () => {
  it('rejects anonymous callers via authedProcedure middleware', async () => {
    const { caller } = makeRouter();
    await expect(
      caller(null).topics.create({ title: 'hello world', body: 'body' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('ForumRouter.topics.update', () => {
  it('writes editedAt when the owner edits inside the 5-minute window', async () => {
    const { caller, topicFindUnique, topicUpdate } = makeRouter();
    topicFindUnique.mockResolvedValueOnce({
      id: 't-current',
      userId: 'u-alice',
      createdAt: new Date(),
    });
    topicUpdate.mockResolvedValueOnce(
      makeTopicRow({
        id: 't-current',
        title: 'edited title',
        body: 'edited body',
        editedAt: new Date('2026-05-01T00:01:00Z'),
      }),
    );

    const result = await caller({
      sub: 'u-alice',
      username: 'alice',
      role: 'user',
      tokenVersion: 0,
      bannedAt: null,
    }).topics.update({
      id: '11111111-1111-4111-a111-111111111111',
      title: 'edited title',
      body: 'edited body',
    });

    expect(topicUpdate.mock.calls[0]?.[0].data).toEqual({
      title: 'edited title',
      body: 'edited body',
      editedAt: expect.any(Date),
    });
    expect(result.editedAt).toBe('2026-05-01T00:01:00.000Z');
  });

  it('forbids edits after the 5-minute window even for the owner', async () => {
    const { caller, topicFindUnique } = makeRouter();
    const longAgo = new Date(Date.now() - 10 * 60_000);
    topicFindUnique.mockResolvedValueOnce({
      id: 't-old',
      userId: 'u-alice',
      createdAt: longAgo,
    });

    await expect(
      caller({
        sub: 'u-alice',
        username: 'alice',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).topics.update({
        id: '11111111-1111-4111-a111-111111111111',
        title: 'still the same',
        body: 'edited later',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('ForumRouter.topics.setPinned', () => {
  it('lets admins pin a topic without marking it edited', async () => {
    const { caller, topicFindUnique, topicUpdate, userFindUnique } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
    topicFindUnique.mockResolvedValueOnce({ id: 't-pin' });
    topicUpdate.mockResolvedValueOnce(
      makeTopicRow({
        id: 't-pin',
        pinned: true,
        editedAt: null,
        updatedAt: new Date('2026-05-01T00:10:00Z'),
      }),
    );

    const result = await caller({
      sub: 'u-admin',
      username: 'admin',
      role: 'admin',
      tokenVersion: 0,
      bannedAt: null,
    }).topics.setPinned({
      id: '44444444-4444-4444-a444-444444444444',
      pinned: true,
    });

    expect(topicUpdate.mock.calls[0]?.[0].data).toEqual({ pinned: true });
    expect(result.pinned).toBe(true);
    expect(result.editedAt).toBeNull();
  });

  it('rejects non-admin callers with FORBIDDEN', async () => {
    const { caller, topicUpdate, userFindUnique } = makeRouter();
    userFindUnique.mockResolvedValueOnce({ role: 'user' });

    await expect(
      caller({
        sub: 'u-bob',
        username: 'bob',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).topics.setPinned({
        id: '55555555-5555-4555-a555-555555555555',
        pinned: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(topicUpdate).not.toHaveBeenCalled();
  });
});

describe('ForumRouter.topics.delete', () => {
  it('lets an admin delete a topic owned by someone else', async () => {
    const { caller, topicFindUnique, topicDelete, userFindUnique } = makeRouter();
    topicFindUnique.mockResolvedValueOnce({
      id: 't-spam',
      userId: 'u-alice',
      title: 'spam',
      createdAt: new Date(),
    });
    userFindUnique.mockResolvedValueOnce({ role: 'admin' });
    topicDelete.mockResolvedValueOnce({});

    const result = await caller({
      sub: 'u-admin',
      username: 'admin',
      role: 'admin',
      tokenVersion: 0,
      bannedAt: null,
    }).topics.delete({
      id: '22222222-2222-4222-a222-222222222222',
    });
    expect(result).toEqual({ ok: true });
    expect(topicDelete).toHaveBeenCalledTimes(1);
  });

  it('rejects non-admin non-owner callers with FORBIDDEN', async () => {
    const { caller, topicFindUnique, topicDelete, userFindUnique } = makeRouter();
    topicFindUnique.mockResolvedValueOnce({
      id: 't-other',
      userId: 'u-alice',
      createdAt: new Date(),
    });
    userFindUnique.mockResolvedValueOnce({ role: 'user' });

    await expect(
      caller({
        sub: 'u-bob',
        username: 'bob',
        role: 'user',
        tokenVersion: 0,
        bannedAt: null,
      }).topics.delete({
        id: '33333333-3333-4333-a333-333333333333',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(topicDelete).not.toHaveBeenCalled();
  });
});
