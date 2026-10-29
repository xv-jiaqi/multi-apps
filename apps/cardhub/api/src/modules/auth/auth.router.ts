import { Injectable, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import { APP_ERROR_CODES, changePasswordInput, loginInput, registerInput } from '@repo/shared';
import { passwordPrehashWriteEnabled } from '../../config/env.validation';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { hashPassword, legacyPasswordExceedsBcryptLimit, verifyPassword } from './password-hash';
import {
  CLEAR_LOGIN_ACCOUNT_LIMIT,
  type ClearLoginAccountLimit,
} from '../../bootstrap/rate-limiters';
import type { TrpcContext } from '../../trpc/context';

function sessionRejected(): TRPCError {
  return new TRPCError({
    code: 'UNAUTHORIZED',
    message: '凭据无效或已过期',
    cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
  });
}

@Injectable()
export class AuthRouter {
  private readonly logger = new Logger(AuthRouter.name);

  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /** Drop the account bucket after a correct password. A failed reset must not turn the login into a 500. */
  private async clearLoginAccountLimit(req: TrpcContext['req'], identifier: string): Promise<void> {
    const clear = req.app?.get(CLEAR_LOGIN_ACCOUNT_LIMIT) as ClearLoginAccountLimit | undefined;
    if (typeof clear !== 'function') return;
    try {
      await clear(identifier);
    } catch (error) {
      const reported = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`login account limit reset failed: ${reported.message}`);
    }
  }

  build() {
    const t = this.t;
    const prisma = this.prisma;
    const auth = this.auth;
    // Read at router build (process start), not from the ConfigModule snapshot.
    // forRoot() validates once per process; tests start a second app after
    // flipping PASSWORD_PREHASH_WRITE.
    const prehashWrite = passwordPrehashWriteEnabled(process.env);

    return t.router({
      register: t.procedure.input(registerInput).mutation(async ({ input }) => {
        const existing = await prisma.user.findFirst({
          where: { OR: [{ email: input.email }, { username: input.username }] },
          select: { id: true, email: true, username: true },
        });
        if (existing) {
          const code = 'CONFLICT' as const;
          const message = existing.email === input.email ? '该邮箱已被注册' : '该用户名已被占用';
          throw new TRPCError({ code, message });
        }

        const hashed = await hashPassword(input.password, { prehash: prehashWrite });
        const user = await prisma.user.create({
          data: {
            email: input.email,
            username: input.username,
            password: hashed,
          },
          select: { id: true, email: true, username: true, role: true, tokenVersion: true },
        });

        const token = auth.sign({ sub: user.id, username: user.username, ver: user.tokenVersion });
        return {
          token,
          user: { id: user.id, email: user.email, username: user.username, role: user.role },
        };
      }),

      login: t.procedure.input(loginInput).mutation(async ({ ctx, input }) => {
        const isEmail = input.identifier.includes('@');
        const user = await prisma.user.findFirst({
          where: isEmail
            ? { email: input.identifier.toLowerCase() }
            : { username: input.identifier },
          select: {
            id: true,
            email: true,
            username: true,
            password: true,
            role: true,
            tokenVersion: true,
            passwordChangeRecommended: true,
            bannedAt: true,
          },
        });
        if (!user) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: '用户名或密码错误',
            cause: { appCode: APP_ERROR_CODES.INVALID_CREDENTIALS },
          });
        }

        const check = await verifyPassword(input.password, user.password, {
          upgrade: prehashWrite,
        });
        if (!check.ok) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: '用户名或密码错误',
            cause: { appCode: APP_ERROR_CODES.INVALID_CREDENTIALS },
          });
        }
        const recommendChange = legacyPasswordExceedsBcryptLimit(user.password, input.password);
        if (check.upgradedHash || recommendChange) {
          try {
            await prisma.user.updateMany({
              where: { id: user.id, password: user.password },
              data: {
                ...(check.upgradedHash ? { password: check.upgradedHash } : {}),
                ...(recommendChange ? { passwordChangeRecommended: true } : {}),
              },
            });
          } catch (error) {
            const reported = error instanceof Error ? error : new Error(String(error));
            this.logger.error(reported.message, reported.stack);
            Sentry.captureException(reported);
          }
        }

        const token = auth.sign({ sub: user.id, username: user.username, ver: user.tokenVersion });
        await this.clearLoginAccountLimit(ctx.req, input.identifier);
        return {
          token,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            passwordChangeRecommended: user.passwordChangeRecommended || recommendChange,
            bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
          },
        };
      }),

      changePassword: t.authedProcedure
        .input(changePasswordInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw sessionRejected();
          const user = await prisma.user.findUnique({
            where: { id: ctx.user.sub },
            select: { id: true, username: true, password: true },
          });
          if (!user) throw sessionRejected();

          const matches = await verifyPassword(input.currentPassword, user.password);
          if (!matches.ok) {
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: '当前密码不正确',
              cause: { appCode: APP_ERROR_CODES.WRONG_PASSWORD },
            });
          }
          if (input.currentPassword === input.newPassword) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '新密码不能和当前密码相同',
              cause: { appCode: APP_ERROR_CODES.SAME_PASSWORD },
            });
          }

          const hashed = await hashPassword(input.newPassword, { prehash: prehashWrite });
          const updated = await prisma.user.update({
            where: { id: user.id },
            data: {
              password: hashed,
              tokenVersion: { increment: 1 },
              passwordChangeRecommended: false,
            },
            select: { id: true, username: true, tokenVersion: true },
          });
          const token = auth.sign({
            sub: updated.id,
            username: updated.username,
            ver: updated.tokenVersion,
          });
          return { token };
        }),

      signOutAll: t.authedProcedure.mutation(async ({ ctx }) => {
        if (!ctx.user) throw sessionRejected();
        await prisma.user.update({
          where: { id: ctx.user.sub },
          data: { tokenVersion: { increment: 1 } },
        });
        return { ok: true };
      }),

      me: t.authedProcedure
        .input(z.object({ token: z.string().max(4096) }).optional())
        .query(async ({ ctx }) => {
          if (!ctx.user) throw sessionRejected();
          const user = await prisma.user.findUnique({
            where: { id: ctx.user.sub },
            select: {
              id: true,
              email: true,
              username: true,
              role: true,
              passwordChangeRecommended: true,
              bannedAt: true,
            },
          });
          if (!user) throw sessionRejected();
          return {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            passwordChangeRecommended: user.passwordChangeRecommended,
            bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
          };
        }),
    });
  }
}
