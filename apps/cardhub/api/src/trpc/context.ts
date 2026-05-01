import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';

export interface TrpcContext {
  req: CreateExpressContextOptions['req'];
  res: CreateExpressContextOptions['res'];
  user: { sub: string; username: string } | null;
}

export function createContext({ req, res }: CreateExpressContextOptions): TrpcContext {
  return {
    req,
    res,
    user: null,
  };
}
