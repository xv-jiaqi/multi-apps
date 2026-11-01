/*
 * This package exposes the server AppRouter type to all clients without pulling
 * in server code at runtime. The API (apps/cardhub/api) re-exports its router
 * shape here via a type-only import.
 *
 * Clients import `AppRouter` and pass it as a generic to `createTRPCClient` /
 * `createTRPCReact`, giving them full end-to-end type safety for procedures,
 * inputs and outputs.
 */

import type { inferProcedureInput } from '@trpc/server';
import type { AppRouter } from './app-router';

type SeriesListProcedureInput = inferProcedureInput<AppRouter['series']['list']>;
type SeriesListFields = Exclude<SeriesListProcedureInput, undefined | void>;

/**
 * `series.list` stays backward compatible: `releasedOnOrBefore` is optional.
 * Assigning `true` fails typecheck if the field is missing or required.
 */
type ReleasedOnOrBeforeIsOptional = 'releasedOnOrBefore' extends keyof SeriesListFields
  ? Omit<SeriesListFields, 'releasedOnOrBefore'> extends SeriesListFields
    ? SeriesListFields extends { releasedOnOrBefore?: string | undefined }
      ? true
      : false
    : false
  : false;

export const seriesListAcceptsReleasedOnOrBefore: ReleasedOnOrBeforeIsOptional = true;

export type { AppRouter } from './app-router';
