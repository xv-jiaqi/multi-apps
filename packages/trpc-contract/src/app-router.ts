/*
 * The real AppRouter type is declared in the API (apps/cardhub/api/src/trpc).
 * We re-export it here so all clients (web / native / miniapp) can depend on
 * a stable, type-only barrel without pulling in the API's runtime code.
 *
 * Note: `@cardhub/api` is declared as a devDependency + peerDependency so that
 * only its type surface is consumed.
 */

export type { AppRouter } from '@cardhub/api/trpc';
