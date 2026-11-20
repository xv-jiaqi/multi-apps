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
    listingUpdate,
    userFindUnique,
  };
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

  it('keeps a listing out of miniapp until a pass callback, then hides it again on risky', async () => {
    const {
      service,
      contentSafetyCheckCreate,
      contentSafetyCheckFindUnique,
      contentSafetyCheckFindMany,
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
    expect(typeof mediaLog?.traceId).toBe('string');

    contentSafetyCheckFindUnique.mockResolvedValue({
      id: 'img-1',
      kind: 'IMAGE',
      targetType: 'LISTING',
      targetId: 'listing-1',
      traceId: mediaLog?.traceId,
    });
    contentSafetyCheckFindMany.mockResolvedValueOnce([
      { kind: 'TEXT', result: 'pass' },
      { kind: 'IMAGE', result: 'pass' },
    ]);
    await service.handleMediaCallback({ traceId: mediaLog.traceId, suggest: 'pass' });
    expect(listingUpdate).toHaveBeenLastCalledWith({
      where: { id: 'listing-1' },
      data: { safetyStatus: 'PASS' },
    });

    contentSafetyCheckFindMany.mockResolvedValueOnce([
      { kind: 'TEXT', result: 'pass' },
      { kind: 'IMAGE', result: 'risky' },
    ]);
    await service.handleMediaCallback({ traceId: mediaLog.traceId, suggest: 'risky' });
    expect(listingUpdate).toHaveBeenLastCalledWith({
      where: { id: 'listing-1' },
      data: { safetyStatus: 'RISKY' },
    });
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
