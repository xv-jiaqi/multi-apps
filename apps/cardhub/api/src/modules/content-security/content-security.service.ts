import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import type { ContentSafetyKind, ContentSafetyStatus } from '@prisma/client';
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
  private envReader: () => ContentSecurityEnv = () => readContentSecurityEnv();
  private wechatOverride: WechatSecCheckClient | undefined;
  private nowFn: () => number = Date.now;

  constructor(private readonly prisma: PrismaService) {}

  /** Test-only hooks. Production never calls this. */
  useTestHooks(hooks: {
    env?: () => ContentSecurityEnv;
    wechat?: WechatSecCheckClient;
    now?: () => number;
  }): this {
    if (hooks.env) this.envReader = hooks.env;
    if (hooks.wechat) this.wechatOverride = hooks.wechat;
    if (hooks.now) this.nowFn = hooks.now;
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
    for (const mediaUrl of args.decision.pendingMedia) {
      const traceId = await this.submitMedia({
        env,
        openid,
        scene: args.scene,
        mediaUrl,
      });
      await this.writeCheck({
        actor,
        actorId: args.actorId,
        targetType: args.targetType,
        targetId: args.targetId,
        kind: 'IMAGE',
        scene: args.scene,
        excerpt: excerptOf([mediaUrl]),
        result: 'pending',
        mediaUrl,
        traceId,
      });
    }
  }

  async handleMediaCallback(input: { traceId: string; suggest: TextSuggest }): Promise<void> {
    const check = await this.prisma.contentSafetyCheck.findUnique({
      where: { traceId: input.traceId },
    });
    if (!check || check.kind !== 'IMAGE' || !check.targetType || !check.targetId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '媒体检查记录不存在' });
    }
    await this.prisma.contentSafetyCheck.update({
      where: { id: check.id },
      data: { result: input.suggest, decidedAt: new Date(this.now()) },
    });
    await this.recomputeTargetStatus({
      targetType: check.targetType,
      targetId: check.targetId,
    });
  }

  async recordMiniappVisit(input: { userId: string; openid: string }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.userId },
      data: { wechatOpenid: input.openid, miniappLastSeenAt: new Date(this.now()) },
    });
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

  private wechatClient(env: ContentSecurityEnv): WechatSecCheckClient {
    if (this.wechatOverride) return this.wechatOverride;
    return new WechatApiSecCheckClient({ appId: env.appId, appSecret: env.appSecret });
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
  }): Promise<void> {
    await this.prisma.contentSafetyCheck.create({
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
