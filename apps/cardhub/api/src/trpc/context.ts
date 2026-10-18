import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { InvalidAuthTokenError, type AuthService } from '../modules/auth/auth.service';
import type { PrismaService } from '../modules/prisma/prisma.service';

export interface TrpcUser {
  sub: string;
  username: string;
  role: string;
  tokenVersion: number;
}

export interface TrpcContext {
  req: CreateExpressContextOptions['req'];
  res: CreateExpressContextOptions['res'];
  user: TrpcUser | null;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Build the tRPC `createContext` callback wired against a real Nest-managed
 * AuthService. The factory pattern keeps the express adapter unaware of the
 * DI container while still letting authedProcedure middlewares trust the
 * resulting `ctx.user`.
 *
 * A verified token loads the user once (`tokenVersion` + `role`). Procedure
 * code, including adminProcedure, must reuse that row instead of querying
 * the user again for the role.
 */
export function makeCreateContext(auth: AuthService, prisma: PrismaService) {
  return async ({ req, res }: CreateExpressContextOptions): Promise<TrpcContext> => {
    const header = req.headers['authorization'];
    if (typeof header === 'string' && header.startsWith(BEARER_PREFIX)) {
      const token = header.slice(BEARER_PREFIX.length).trim();
      if (token) {
        try {
          const payload = auth.verify(token);
          const tokenVer = typeof payload.ver === 'number' ? payload.ver : 0;
          const row = await prisma.user.findUnique({
            where: { id: payload.sub },
            select: { tokenVersion: true, role: true },
          });
          if (row && row.tokenVersion === tokenVer) {
            return {
              req,
              res,
              user: {
                sub: payload.sub,
                username: payload.username,
                role: row.role,
                tokenVersion: row.tokenVersion,
              },
            };
          }
        } catch (error) {
          if (!(error instanceof InvalidAuthTokenError)) throw error;
        }
      }
    }
    return { req, res, user: null };
  };
}
