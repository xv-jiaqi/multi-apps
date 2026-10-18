import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { APP_ERROR_CODES, changePasswordInput, loginInput, registerInput } from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthRouter {
  constructor(
    private readonly t: TrpcBase,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  build() {
    const t = this.t;
    const prisma = this.prisma;
    const auth = this.auth;

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

        const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
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

      login: t.procedure.input(loginInput).mutation(async ({ input }) => {
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
          },
        });
        if (!user) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: '用户名或密码错误',
            cause: { appCode: APP_ERROR_CODES.INVALID_CREDENTIALS },
          });
        }

        const ok = await bcrypt.compare(input.password, user.password);
        if (!ok) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: '用户名或密码错误',
            cause: { appCode: APP_ERROR_CODES.INVALID_CREDENTIALS },
          });
        }

        const token = auth.sign({ sub: user.id, username: user.username, ver: user.tokenVersion });
        return {
          token,
          user: { id: user.id, email: user.email, username: user.username, role: user.role },
        };
      }),

      changePassword: t.authedProcedure
        .input(changePasswordInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const user = await prisma.user.findUnique({
            where: { id: ctx.user.sub },
            select: { id: true, username: true, password: true },
          });
          if (!user) {
            throw new TRPCError({ code: 'UNAUTHORIZED', message: '凭据无效或已过期' });
          }

          const matches = await bcrypt.compare(input.currentPassword, user.password);
          if (!matches) {
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

          const hashed = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
          const updated = await prisma.user.update({
            where: { id: user.id },
            data: {
              password: hashed,
              tokenVersion: { increment: 1 },
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
        if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        await prisma.user.update({
          where: { id: ctx.user.sub },
          data: { tokenVersion: { increment: 1 } },
        });
        return { ok: true };
      }),

      me: t.authedProcedure
        .input(z.object({ token: z.string().max(4096) }).optional())
        .query(async ({ ctx }) => {
          if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
          const user = await prisma.user.findUnique({
            where: { id: ctx.user.sub },
            select: { id: true, email: true, username: true, role: true },
          });
          if (!user) {
            throw new TRPCError({ code: 'UNAUTHORIZED', message: '凭据无效或已过期' });
          }
          return user;
        }),
    });
  }
}
