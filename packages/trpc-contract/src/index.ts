/*
 * This package exposes the server AppRouter type to all clients without pulling
 * in server code at runtime. The API (apps/cardhub/api) re-exports its router
 * shape here via a type-only import.
 *
 * Clients import `AppRouter` and pass it as a generic to `createTRPCClient` /
 * `createTRPCReact`, giving them full end-to-end type safety for procedures,
 * inputs and outputs.
 */

export type { AppRouter } from './app-router';
