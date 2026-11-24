import { APP_ERROR_CODES } from '@repo/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { ContentSecurityService, aggregateTargetStatus } from './content-security.service';
import type { ContentSecurityEnv } from '../../config/content-security-env';
import type { WechatSecCheckClient } from './wechat-sec-check.client';

const NOW = Date.parse('2026-11-18T05:00:00.000Z');

function env(overrides: Partial<ContentSecurityEnv> = {}): ContentSecurityEnv {
  return {
    nodeEnv: 'test',
    appId: '',
    appSecret: '',
    callbackToken: '',
    testResult: null,
    credentialsConfigured: false,
    ...overrides,
  };
}

function actorRow(overrides: { openid?: string | null; seenAt?: Date | null } = {}) {
  return {
    wechatOpenid: overrides.openid === undefined ? 'o-1' : overrides.openid,
    miniappLastSeenAt:
      overrides.seenAt === undefined ? new Date(NOW - 10 * 60 * 1000) : overrides.seenAt,
    username: 'alice',
  };
}

function makeService(args: {
  env: ContentSecurityEnv;
  wechat?: WechatSecCheckClient;
  user?: ReturnType<typeof actorRow> | null;
}) {
  const contentSafetyCheckCreate = jest.fn().mockResolvedValue({ id: 'chk-1' });
  const contentSafetyCheckFindUnique = jest.fn();
  const contentSafetyCheckFindMany = jest.fn();
  const contentSafetyCheckUpdate = jest.fn().mockResolvedValue({});
  const contentSafetyCheckUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const listingUpdate = jest.fn().mockResolvedValue({});
  const userFindUnique = jest
    .fn()
    .mockResolvedValue(args.user === undefined ? actorRow() : args.user);

  const prisma = {
    user: { findUnique: userFindUnique, update: jest.fn().mockResolvedValue({}) },
    contentSafetyCheck: {
      create: contentSafetyCheckCreate,
      findUnique: contentSafetyCheckFindUnique,
      findMany: contentSafetyCheckFindMany,
      update: contentSafetyCheckUpdate,
      updateMany: contentSafetyCheckUpdateMany,
    },
    topic: { update: jest.fn().mockResolvedValue({}) },
    reply: { update: jest.fn().mockResolvedValue({}) },
    comment: { update: jest.fn().mockResolvedValue({}) },
    listing: { update: listingUpdate },
    report: { update: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;

  const service = new ContentSecurityService(prisma).useTestHooks({
    env: () => args.env,
    wechat: args.wechat,
    now: () => NOW,
  });

  return {
    service,
    prisma,
    contentSafetyCheckCreate,
    contentSafetyCheckFindUnique,
    contentSafetyCheckFindMany,
    contentSafetyCheckUpdate,
    contentSafetyCheckUpdateMany,
    listingUpdate,
    userFindUnique,
  };
}

function makeStatefulService(args: { env: ContentSecurityEnv; wechat?: WechatSecCheckClient }) {
  type CheckRow = {
    id: string;
    kind: string;
    result: string;
    targetType?: string | null;
    targetId?: string | null;
    traceId?: string | null;
    mediaUrl?: string | null;
    decidedAt?: Date | null;
  };
  const checks: CheckRow[] = [];
  let listingStatus: string | undefined;
  let nextId = 0;

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(actorRow()),
      update: jest.fn().mockResolvedValue({}),
    },
    contentSafetyCheck: {
      create: jest.fn(async ({ data }: { data: Omit<CheckRow, 'id'> & { id?: string } }) => {
        const row: CheckRow = { ...data, id: data.id ?? `chk-${++nextId}` };
        checks.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id?: string; traceId?: string } }) => {
        return (
          checks.find(
            (row) =>
              (where.traceId !== undefined && row.traceId === where.traceId) ||
              (where.id !== undefined && row.id === where.id),
          ) ?? null
        );
      }),
      findMany: jest.fn(
        async ({ where }: { where: { targetType?: string; targetId?: string } }) => {
          return checks.filter(
            (row) =>
              (where.targetType === undefined || row.targetType === where.targetType) &&
              (where.targetId === undefined || row.targetId === where.targetId),
          );
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<CheckRow> }) => {
          const row = checks.find((item) => item.id === where.id);
          if (!row) throw new Error('contentSafetyCheck not found');
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; traceId?: string; result?: string; kind?: string };
          data: Partial<CheckRow>;
        }) => {
          const matched = checks.filter((row) => {
            if (where.id !== undefined && row.id !== where.id) return false;
            if (where.traceId !== undefined && row.traceId !== where.traceId) return false;
            if (where.result !== undefined && row.result !== where.result) return false;
            if (where.kind !== undefined && row.kind !== where.kind) return false;
            return true;
          });
          for (const row of matched) Object.assign(row, data);
          return { count: matched.length };
        },
      ),
    },
    topic: { update: jest.fn().mockResolvedValue({}) },
    reply: { update: jest.fn().mockResolvedValue({}) },
    comment: { update: jest.fn().mockResolvedValue({}) },
    listing: {
      update: jest.fn(async ({ data }: { data: { safetyStatus: string } }) => {
        listingStatus = data.safetyStatus;
        return data;
      }),
    },
    report: { update: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;

  const service = new ContentSecurityService(prisma).useTestHooks({
    env: () => args.env,
    wechat: args.wechat,
    now: () => NOW,
  });

  return { service, checks, listingStatus: () => listingStatus, prisma };
}

describe('ContentSecurityService.evaluateWrite', () => {
  it('writes unchecked without calling WeChat when credentials are missing', async () => {
    const wechat: WechatSecCheckClient = {
      msgSecCheck: jest.fn(),
      mediaCheckAsync: jest.fn(),
    };
    const { service, contentSafetyCheckCreate } = makeService({
      env: env(),
      wechat,
    });

    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 3,
      texts: ['hello world'],
      targetType: 'TOPIC',
    });

    expect(decision).toMatchObject({ safetyStatus: 'UNCHECKED', textResult: 'unchecked' });
    expect(wechat.msgSecCheck).not.toHaveBeenCalled();
    expect(contentSafetyCheckCreate).not.toHaveBeenCalled();
  });

  it('rejects risky test-switch writes with CONTENT_BLOCKED and keeps a log', async () => {
    const { service, contentSafetyCheckCreate } = makeService({
      env: env({ testResult: 'risky' }),
    });

    await expect(
      service.evaluateWrite({
        actorId: 'u-alice',
        scene: 3,
        texts: ['blocked'],
        targetType: 'TOPIC',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '内容未通过审核，请修改后再试',
      cause: { appCode: APP_ERROR_CODES.CONTENT_BLOCKED },
    });

    const log = contentSafetyCheckCreate.mock.calls[0]?.[0]?.data;
    expect(log).toMatchObject({
      actorId: 'u-alice',
      actorUsername: 'alice',
      excerpt: 'blocked',
      result: 'risky',
      targetId: undefined,
    });
    expect(JSON.stringify(log)).not.toContain('testResult');
    expect(JSON.stringify(log)).not.toContain('WECHAT');
  });

  it('marks review when the test switch asks for review', async () => {
    const { service } = makeService({ env: env({ testResult: 'review' }) });
    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 2,
      texts: ['maybe'],
      targetType: 'COMMENT',
    });
    expect(decision.safetyStatus).toBe('REVIEW');
    expect(decision.textResult).toBe('review');
  });

  it('marks pass when the test switch asks for pass and there are no images', async () => {
    const { service } = makeService({ env: env({ testResult: 'pass' }) });
    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 3,
      texts: ['ok'],
      targetType: 'TOPIC',
    });
    expect(decision.safetyStatus).toBe('PASS');
  });

  it('keeps pending media in review even when text passes', async () => {
    const { service } = makeService({ env: env({ testResult: 'pass' }) });
    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 4,
      texts: ['see https://cdn.example/a.png'],
      imageUrls: ['https://cdn.example/b.jpg'],
      targetType: 'LISTING',
    });
    expect(decision.safetyStatus).toBe('REVIEW');
    expect(decision.pendingMedia).toEqual([
      'https://cdn.example/b.jpg',
      'https://cdn.example/a.png',
    ]);
  });

  it('uses WeChat when credentials and a fresh openid are present', async () => {
    const wechat: WechatSecCheckClient = {
      msgSecCheck: jest.fn().mockResolvedValue('pass'),
      mediaCheckAsync: jest.fn(),
    };
    const { service } = makeService({
      env: env({
        appId: 'wx-app',
        appSecret: 'wx-secret',
        credentialsConfigured: true,
      }),
      wechat,
    });
    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 3,
      texts: ['ok'],
      targetType: 'TOPIC',
    });
    expect(decision.safetyStatus).toBe('PASS');
    expect(wechat.msgSecCheck).toHaveBeenCalledWith({
      openid: 'o-1',
      scene: 3,
      content: 'ok',
    });
  });

  it('stores unchecked when credentials exist but openid is stale', async () => {
    const wechat: WechatSecCheckClient = {
      msgSecCheck: jest.fn(),
      mediaCheckAsync: jest.fn(),
    };
    const { service } = makeService({
      env: env({
        appId: 'wx-app',
        appSecret: 'wx-secret',
        credentialsConfigured: true,
      }),
      wechat,
      user: actorRow({ seenAt: new Date(NOW - 3 * 60 * 60 * 1000) }),
    });
    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 3,
      texts: ['ok'],
      targetType: 'TOPIC',
    });
    expect(decision.safetyStatus).toBe('UNCHECKED');
    expect(wechat.msgSecCheck).not.toHaveBeenCalled();
  });

  it('fails closed when the test switch is set in production', async () => {
    const { service, contentSafetyCheckCreate } = makeService({
      env: env({ nodeEnv: 'production', testResult: 'pass' }),
    });
    await expect(
      service.evaluateWrite({
        actorId: 'u-alice',
        scene: 3,
        texts: ['ok'],
        targetType: 'TOPIC',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(contentSafetyCheckCreate).not.toHaveBeenCalled();
  });
});

describe('ContentSecurityService.finalizeWrite and media callback', () => {
  it('records a text check for unchecked writes and skips media submit', async () => {
    const wechat: WechatSecCheckClient = {
      msgSecCheck: jest.fn(),
      mediaCheckAsync: jest.fn(),
    };
    const { service, contentSafetyCheckCreate } = makeService({ env: env(), wechat });
    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 4,
      texts: ['note'],
      imageUrls: ['https://cdn.example/a.png'],
      targetType: 'LISTING',
    });
    await service.finalizeWrite({
      decision,
      actorId: 'u-alice',
      targetType: 'LISTING',
      targetId: 'listing-1',
      scene: 4,
    });
    expect(contentSafetyCheckCreate).toHaveBeenCalledTimes(1);
    expect(contentSafetyCheckCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      targetId: 'listing-1',
      result: 'unchecked',
      actorUsername: 'alice',
    });
    expect(wechat.mediaCheckAsync).not.toHaveBeenCalled();
  });

  it('keeps a listing out of miniapp until a pass callback', async () => {
    const {
      service,
      contentSafetyCheckCreate,
      contentSafetyCheckFindUnique,
      contentSafetyCheckFindMany,
      contentSafetyCheckUpdate,
      listingUpdate,
    } = makeService({ env: env({ testResult: 'pass' }) });

    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 4,
      texts: ['note'],
      imageUrls: ['https://cdn.example/a.png'],
      targetType: 'LISTING',
    });
    expect(decision.safetyStatus).toBe('REVIEW');

    await service.finalizeWrite({
      decision,
      actorId: 'u-alice',
      targetType: 'LISTING',
      targetId: 'listing-1',
      scene: 4,
    });
    const mediaLog = contentSafetyCheckCreate.mock.calls.find(
      (call) => call[0]?.data?.kind === 'IMAGE',
    )?.[0]?.data;
    expect(mediaLog?.result).toBe('pending');
    const assignedTraceId = contentSafetyCheckUpdate.mock.calls[0]?.[0]?.data?.traceId as
      | string
      | undefined;
    expect(typeof assignedTraceId).toBe('string');

    contentSafetyCheckFindUnique.mockResolvedValue({
      id: 'chk-1',
      kind: 'IMAGE',
      targetType: 'LISTING',
      targetId: 'listing-1',
      traceId: assignedTraceId,
    });
    contentSafetyCheckFindMany.mockResolvedValueOnce([
      { kind: 'TEXT', result: 'pass' },
      { kind: 'IMAGE', result: 'pass' },
    ]);
    await service.handleMediaCallback({ traceId: assignedTraceId!, suggest: 'pass' });
    expect(listingUpdate).toHaveBeenLastCalledWith({
      where: { id: 'listing-1' },
      data: { safetyStatus: 'PASS' },
    });
  });

  it('does not mark a post public when a later image fails submission and an earlier one later passes', async () => {
    const wechat: WechatSecCheckClient = {
      msgSecCheck: jest.fn().mockResolvedValue('pass'),
      mediaCheckAsync: jest
        .fn()
        .mockResolvedValueOnce({ traceId: 'tr-a' })
        .mockRejectedValueOnce(new Error('WeChat mediaCheckAsync failed')),
    };
    const { service, listingStatus } = makeStatefulService({
      env: env({
        testResult: 'pass',
        credentialsConfigured: true,
        appId: 'wx-test',
        appSecret: 'secret',
      }),
      wechat,
    });

    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 3,
      texts: ['hello'],
      imageUrls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
      targetType: 'LISTING',
    });
    expect(decision.safetyStatus).toBe('REVIEW');
    expect(decision.pendingMedia).toEqual([
      'https://cdn.example/a.png',
      'https://cdn.example/b.png',
    ]);

    await service
      .finalizeWrite({
        decision,
        actorId: 'u-alice',
        targetType: 'LISTING',
        targetId: 'listing-2',
        scene: 3,
      })
      .catch(() => undefined);

    const submitted = wechat.mediaCheckAsync as jest.Mock;
    expect(submitted).toHaveBeenCalled();
    await service.handleMediaCallback({ traceId: 'tr-a', suggest: 'pass' });

    expect(listingStatus()).not.toBe('PASS');
  });

  it('does not let a later pass callback overwrite an already decided risky result', async () => {
    const wechat: WechatSecCheckClient = {
      msgSecCheck: jest.fn(),
      mediaCheckAsync: jest.fn().mockResolvedValue({ traceId: 'tr-only' }),
    };
    const { service, listingStatus } = makeStatefulService({
      env: env({
        testResult: 'pass',
        credentialsConfigured: true,
        appId: 'wx-test',
        appSecret: 'secret',
      }),
      wechat,
    });

    const decision = await service.evaluateWrite({
      actorId: 'u-alice',
      scene: 4,
      texts: ['note'],
      imageUrls: ['https://cdn.example/a.png'],
      targetType: 'LISTING',
    });
    await service.finalizeWrite({
      decision,
      actorId: 'u-alice',
      targetType: 'LISTING',
      targetId: 'listing-3',
      scene: 4,
    });

    await service.handleMediaCallback({ traceId: 'tr-only', suggest: 'risky' });
    expect(listingStatus()).toBe('RISKY');
    await service.handleMediaCallback({ traceId: 'tr-only', suggest: 'pass' });
    expect(listingStatus()).toBe('RISKY');
  });
});

describe('aggregateTargetStatus', () => {
  it('stays in review while any image is pending', () => {
    expect(
      aggregateTargetStatus([
        { kind: 'TEXT', result: 'pass' },
        { kind: 'IMAGE', result: 'pending' },
      ]),
    ).toBe('REVIEW');
  });
});
