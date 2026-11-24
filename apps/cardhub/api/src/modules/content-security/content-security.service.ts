import { Injectable, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import type { ContentSafetyKind, ContentSafetyStatus } from '@prisma/client';
import { APP_ERROR_CODES, t } from '@repo/shared';
import {
  contentSecurityEnvError,
  readContentSecurityEnv,
  type ContentSecurityEnv,
} from '../../config/content-security-env';
import { PrismaService } from '../prisma/prisma.service';
import { contentBlockedError } from './content-blocked';
import {
  excerptOf,
  extractHttpsImageUrls,
  splitTextForMsgSecCheck,
  worstTextSuggest,
  type TextSuggest,
} from './image-urls';
import {
  WechatApiSecCheckClient,
  type Code2SessionResult,
  type MsgSecCheckScene,
  type WechatSecCheckClient,
} from './wechat-sec-check.client';

export type ContentSafetyTargetType = 'TOPIC' | 'REPLY' | 'COMMENT' | 'LISTING' | 'REPORT';

const OPENID_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface EvaluateWriteInput {
  actorId: string;
  scene: MsgSecCheckScene;
  texts: readonly string[];
  imageUrls?: readonly string[];
  targetType: ContentSafetyTargetType;
}

export interface EvaluateWriteResult {
  safetyStatus: Exclude<ContentSafetyStatus, 'RISKY'>;
  textResult: Exclude<TextSuggest, 'risky'> | 'unchecked';
  excerpt: string;
  pendingMedia: string[];
  openid: string | null;
}

interface ActorRow {
  wechatOpenid: string | null;
  miniappLastSeenAt: Date | null;
  username: string;
}

@Injectable()
export class ContentSecurityService {
  private readonly logger = new Logger(ContentSecurityService.name);
  private envReader: () => ContentSecurityEnv = () => readContentSecurityEnv();
  private wechatOverride: WechatSecCheckClient | undefined;
  private code2SessionOverride:
    | ((input: { code: string }) => Promise<Code2SessionResult>)
    | undefined;
  private nowFn: () => number = Date.now;
  private logOverride:
    | ((level: 'log' | 'warn', message: string, payload: Record<string, unknown>) => void)
    | undefined;

  constructor(private readonly prisma: PrismaService) {}

  /** Test-only hooks. Production never calls this. */
  useTestHooks(hooks: {
    env?: () => ContentSecurityEnv;
    wechat?: WechatSecCheckClient;
    code2Session?: (input: { code: string }) => Promise<Code2SessionResult>;
    now?: () => number;
    log?: (level: 'log' | 'warn', message: string, payload: Record<string, unknown>) => void;
  }): this {
    if (hooks.env) this.envReader = hooks.env;
    if (hooks.wechat) this.wechatOverride = hooks.wechat;
    if (hooks.code2Session) this.code2SessionOverride = hooks.code2Session;
    if (hooks.now) this.nowFn = hooks.now;
    if (hooks.log) this.logOverride = hooks.log;
    return this;
  }

  private env(): ContentSecurityEnv {
    return this.envReader();
  }

  private now(): number {
    return this.nowFn();
  }

  /**
   * Inspect text (and collect image URLs). `risky` is logged and thrown.
   * The caller should create the row with `safetyStatus`, then `finalizeWrite`.
   */
  async evaluateWrite(input: EvaluateWriteInput): Promise<EvaluateWriteResult> {
    const env = this.requireNonProductionSwitch(this.env());
    const excerpt = excerptOf(input.texts);
    const pendingMedia = extractHttpsImageUrls({
      texts: input.texts,
      imageUrls: input.imageUrls,
    });
    const actor = await this.prisma.user.findUnique({
      where: { id: input.actorId },
      select: { wechatOpenid: true, miniappLastSeenAt: true, username: true },
    });
    const openid = this.usableOpenid(actor);

    if (env.testResult !== null) {
      if (env.testResult === 'risky') {
        await this.writeCheck({
          actor,
          actorId: input.actorId,
          targetType: input.targetType,
          kind: 'TEXT',
          scene: input.scene,
          excerpt,
          result: 'risky',
        });
        throw contentBlockedError();
      }
      const textResult = env.testResult;
      return {
        safetyStatus: this.statusForWrite({ textResult, pendingMedia, openid, env }),
        textResult,
        excerpt,
        pendingMedia,
        openid,
      };
    }

    if (!env.credentialsConfigured || !openid) {
      return {
        safetyStatus: 'UNCHECKED',
        textResult: 'unchecked',
        excerpt,
        pendingMedia,
        openid,
      };
    }

    const suggest = await this.checkTextWithWeChat({
      openid,
      scene: input.scene,
      texts: input.texts,
      env,
    });
    if (suggest === 'risky') {
      await this.writeCheck({
        actor,
        actorId: input.actorId,
        targetType: input.targetType,
        kind: 'TEXT',
        scene: input.scene,
        excerpt,
        result: 'risky',
      });
      throw contentBlockedError();
    }
    return {
      safetyStatus: this.statusForWrite({ textResult: suggest, pendingMedia, openid, env }),
      textResult: suggest,
      excerpt,
      pendingMedia,
      openid,
    };
  }

  async finalizeWrite(args: {
    decision: EvaluateWriteResult;
    actorId: string;
    targetType: ContentSafetyTargetType;
    targetId: string;
    scene: MsgSecCheckScene;
  }): Promise<void> {
    const env = this.requireNonProductionSwitch(this.env());
    const actor = await this.prisma.user.findUnique({
      where: { id: args.actorId },
      select: { wechatOpenid: true, miniappLastSeenAt: true, username: true },
    });
    await this.writeCheck({
      actor,
      actorId: args.actorId,
      targetType: args.targetType,
      targetId: args.targetId,
      kind: 'TEXT',
      scene: args.scene,
      excerpt: args.decision.excerpt,
      result: args.decision.textResult,
    });

    if (
      args.decision.pendingMedia.length === 0 ||
      args.decision.textResult === 'unchecked' ||
      !args.decision.openid ||
      (!env.credentialsConfigured && env.testResult === null)
    ) {
      return;
    }

    const openid = args.decision.openid;
    // Write every image as pending before any WeChat call. If a later
    // submit fails, the row stays pending so a pass on the other images
    // cannot aggregate to PASS (AC 248-4).
    const pendingIds: Array<{ id: string; mediaUrl: string }> = [];
    for (const mediaUrl of args.decision.pendingMedia) {
      const created = await this.writeCheck({
        actor,
        actorId: args.actorId,
        targetType: args.targetType,
        targetId: args.targetId,
        kind: 'IMAGE',
        scene: args.scene,
        excerpt: excerptOf([mediaUrl]),
        result: 'pending',
        mediaUrl,
      });
      pendingIds.push({ id: created.id, mediaUrl });
    }
    for (const pending of pendingIds) {
      try {
        const traceId = await this.submitMedia({
          env,
          openid,
          scene: args.scene,
          mediaUrl: pending.mediaUrl,
        });
        await this.prisma.contentSafetyCheck.update({
          where: { id: pending.id },
          data: { traceId },
        });
      } catch {
        // Leave the row pending. The post is already saved; throwing
        // would 500 the client and still leave a public-able row.
      }
    }
  }

  async handleMediaCallback(input: { traceId: string; suggest: TextSuggest }): Promise<void> {
    const check = await this.prisma.contentSafetyCheck.findUnique({
      where: { traceId: input.traceId },
    });
    if (!check || check.kind !== 'IMAGE' || !check.targetType || !check.targetId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '媒体检查记录不存在' });
    }
    const updated = await this.prisma.contentSafetyCheck.updateMany({
      where: { id: check.id, result: 'pending' },
      data: { result: input.suggest, decidedAt: new Date(this.now()) },
    });
    if (updated.count === 0) return;
    await this.recomputeTargetStatus({
      targetType: check.targetType,
      targetId: check.targetId,
    });
  }

  /**
   * Exchange a one-time login code for openid and record a mini-program visit.
   * session_key is never stored or logged. The same code is never retried.
   */
  async recordMiniappVisit(input: { userId: string; code: string }): Promise<void> {
    const env = this.env();
    if (!env.credentialsConfigured) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: t('zh-CN', 'error.app.MINIAPP_NOT_CONFIGURED'),
        cause: { appCode: APP_ERROR_CODES.MINIAPP_NOT_CONFIGURED },
      });
    }
    const exchanged = await this.exchangeLoginCode({ code: input.code });
    if (exchanged.ok === false) {
      this.safeLog('warn', 'miniapp code2Session failed', {
        event: 'miniapp_code2session_failed',
        userId: input.userId,
        errcode: exchanged.errcode,
      });
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: t('zh-CN', 'error.app.BAD_GATEWAY'),
        cause: { appCode: APP_ERROR_CODES.BAD_GATEWAY },
      });
    }
    await this.prisma.user.update({
      where: { id: input.userId },
      data: { wechatOpenid: exchanged.openid, miniappLastSeenAt: new Date(this.now()) },
    });
    this.safeLog('log', 'miniapp visit recorded', {
      event: 'miniapp_visit_recorded',
      userId: input.userId,
    });
  }

  private async exchangeLoginCode(input: { code: string }): Promise<Code2SessionResult> {
    if (this.code2SessionOverride) {
      return this.code2SessionOverride(input);
    }
    const env = this.env();
    const client = new WechatApiSecCheckClient({
      appId: env.appId,
      appSecret: env.appSecret,
    });
    return client.code2Session(input);
  }

  private safeLog(level: 'log' | 'warn', message: string, payload: Record<string, unknown>): void {
    if (this.logOverride) {
      this.logOverride(level, message, payload);
      return;
    }
    const line = `${message} ${JSON.stringify(payload)}`;
    if (level === 'warn') this.logger.warn(line);
    else this.logger.log(line);
  }

  private requireNonProductionSwitch(env: ContentSecurityEnv): ContentSecurityEnv {
    const error = contentSecurityEnvError(env);
    if (error) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '内容安全测试开关在生产环境不可用',
      });
    }
    return env;
  }

  private usableOpenid(actor: ActorRow | null): string | null {
    if (!actor?.wechatOpenid) return null;
    if (!actor.miniappLastSeenAt) return null;
    if (this.now() - actor.miniappLastSeenAt.getTime() > OPENID_MAX_AGE_MS) return null;
    return actor.wechatOpenid;
  }

  private statusForWrite(args: {
    textResult: Exclude<TextSuggest, 'risky'> | 'unchecked';
    pendingMedia: readonly string[];
    openid: string | null;
    env: ContentSecurityEnv;
  }): Exclude<ContentSafetyStatus, 'RISKY'> {
    if (args.textResult === 'unchecked') return 'UNCHECKED';
    if (args.textResult === 'review') return 'REVIEW';
    const canCheckMedia =
      args.pendingMedia.length > 0 &&
      Boolean(args.openid) &&
      (args.env.credentialsConfigured || args.env.testResult !== null);
    return canCheckMedia ? 'REVIEW' : 'PASS';
  }

  private async checkTextWithWeChat(args: {
    openid: string;
    scene: MsgSecCheckScene;
    texts: readonly string[];
    env: ContentSecurityEnv;
  }): Promise<TextSuggest> {
    const client = this.wechatClient(args.env);
    const chunks = args.texts.flatMap((text) => splitTextForMsgSecCheck(text));
    if (chunks.length === 0) return 'pass';
    const suggests: TextSuggest[] = [];
    for (const content of chunks) {
      suggests.push(await client.msgSecCheck({ openid: args.openid, scene: args.scene, content }));
    }
    return worstTextSuggest(suggests);
  }

  private wechatInstance: WechatSecCheckClient | undefined;

  private wechatClient(env: ContentSecurityEnv): WechatSecCheckClient {
    if (this.wechatOverride) return this.wechatOverride;
    if (!this.wechatInstance) {
      this.wechatInstance = new WechatApiSecCheckClient({
        appId: env.appId,
        appSecret: env.appSecret,
      });
    }
    return this.wechatInstance;
  }

  private async submitMedia(args: {
    env: ContentSecurityEnv;
    openid: string;
    scene: MsgSecCheckScene;
    mediaUrl: string;
  }): Promise<string> {
    if (args.env.testResult !== null && !args.env.credentialsConfigured) {
      return `test-${randomUUID()}`;
    }
    const client = this.wechatClient(args.env);
    const submitted = await client.mediaCheckAsync({
      openid: args.openid,
      scene: args.scene,
      mediaUrl: args.mediaUrl,
      mediaType: 2,
    });
    return submitted.traceId;
  }

  private async writeCheck(args: {
    actor: ActorRow | null;
    actorId: string;
    targetType: ContentSafetyTargetType;
    targetId?: string;
    kind: ContentSafetyKind;
    scene: MsgSecCheckScene;
    excerpt: string;
    result: string;
    mediaUrl?: string;
    traceId?: string;
  }): Promise<{ id: string }> {
    return this.prisma.contentSafetyCheck.create({
      data: {
        actorId: args.actor ? args.actorId : null,
        actorUsername: args.actor?.username ?? 'unknown',
        targetType: args.targetType,
        targetId: args.targetId,
        kind: args.kind,
        scene: args.scene,
        excerpt: args.excerpt,
        result: args.result,
        mediaUrl: args.mediaUrl,
        traceId: args.traceId,
        decidedAt: args.result === 'pending' ? null : new Date(this.now()),
      },
    });
  }

  private async recomputeTargetStatus(args: {
    targetType: string;
    targetId: string;
  }): Promise<void> {
    const checks = await this.prisma.contentSafetyCheck.findMany({
      where: { targetType: args.targetType, targetId: args.targetId },
      select: { kind: true, result: true },
    });
    const next = aggregateTargetStatus(checks);
    await this.updateTargetStatus(args.targetType, args.targetId, next);
  }

  private async updateTargetStatus(
    targetType: string,
    targetId: string,
    safetyStatus: ContentSafetyStatus,
  ): Promise<void> {
    const data = { safetyStatus };
    if (targetType === 'TOPIC') {
      await this.prisma.topic.update({ where: { id: targetId }, data });
      return;
    }
    if (targetType === 'REPLY') {
      await this.prisma.reply.update({ where: { id: targetId }, data });
      return;
    }
    if (targetType === 'COMMENT') {
      await this.prisma.comment.update({ where: { id: targetId }, data });
      return;
    }
    if (targetType === 'LISTING') {
      await this.prisma.listing.update({ where: { id: targetId }, data });
      return;
    }
    if (targetType === 'REPORT') {
      await this.prisma.report.update({ where: { id: targetId }, data });
    }
  }
}

export function aggregateTargetStatus(
  checks: readonly { kind: ContentSafetyKind; result: string }[],
): ContentSafetyStatus {
  const results = checks.map((check) => check.result);
  if (results.includes('risky')) return 'RISKY';
  if (results.includes('pending') || results.includes('review') || results.includes('unchecked')) {
    if (results.includes('pending') || results.includes('review')) return 'REVIEW';
    return 'UNCHECKED';
  }
  return 'PASS';
}
