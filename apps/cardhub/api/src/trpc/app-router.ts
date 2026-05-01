/*
 * Public type-only export consumed by `@repo/trpc-contract` and all frontend
 * clients. Importing this module must NOT pull in any server runtime code —
 * keep it type-only.
 */

export type { AppRouter } from './trpc.service';
