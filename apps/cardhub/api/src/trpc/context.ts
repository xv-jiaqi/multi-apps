import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { AuthService } from '../modules/auth/auth.service';

export interface TrpcContext {
  req: CreateExpressContextOptions['req'];
  res: CreateExpressContextOptions['res'];
  user: { sub: string; username: string } | null;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Build the tRPC `createContext` callback wired against a real Nest-managed
 * AuthService. The factory pattern keeps the express adapter unaware of the
 * DI container while still letting authedProcedure middlewares trust the
 * resulting `ctx.user`.
 */
export function makeCreateContext(auth: AuthService) {
  return ({ req, res }: CreateExpressContextOptions): TrpcContext => {
    const header = req.headers['authorization'];
    if (typeof header === 'string' && header.startsWith(BEARER_PREFIX)) {
      const token = header.slice(BEARER_PREFIX.length).trim();
      if (token) {
        try {
          const payload = auth.verify(token);
          return {
            req,
            res,
            user: { sub: payload.sub, username: payload.username },
          };
        } catch {
          // Fall through to anonymous context — let downstream procedures
          // decide whether the call needs auth.
        }
      }
    }
    return { req, res, user: null };
  };
}
