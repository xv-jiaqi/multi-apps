import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { registerInput, loginInput } from '@repo/shared';
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
          select: { id: true, email: true, username: true, role: true },
        });

        const token = auth.sign({ sub: user.id, username: user.username });
        return { token, user };
      }),

      login: t.procedure.input(loginInput).mutation(async ({ input }) => {
        const isEmail = input.identifier.includes('@');
        const user = await prisma.user.findFirst({
          where: isEmail
            ? { email: input.identifier.toLowerCase() }
            : { username: input.identifier },
          select: { id: true, email: true, username: true, password: true, role: true },
        });
        if (!user) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '用户名或密码错误' });
        }

        const ok = await bcrypt.compare(input.password, user.password);
        if (!ok) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '用户名或密码错误' });
        }

        const token = auth.sign({ sub: user.id, username: user.username });
        return {
          token,
          user: { id: user.id, email: user.email, username: user.username, role: user.role },
        };
      }),

      me: t.procedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
        try {
          const payload = auth.verify(input.token);
          const user = await prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, email: true, username: true, role: true },
          });
          if (!user) throw new Error('user gone');
          return user;
        } catch {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '凭据无效或已过期' });
        }
      }),
    });
  }
}
