import { Logger } from '@nestjs/common';
import type { Server } from 'node:http';

/**
 * Nest's shutdown sequence calls `onModuleDestroy` (Prisma `$disconnect`,
 * Redis `quit`) before it closes the HTTP server. An in-flight request would
 * lose those clients and fail. On SIGTERM/SIGINT we close the listening
 * socket first and make those hooks wait until in-flight responses finish.
 *
 * `app.close()` in tests does not raise a signal, so the hooks disconnect
 * immediately when no drain is in progress.
 *
 * The listener removes itself. After the hooks finish, Nest re-sends the
 * same signal so the default action can exit the process. A listener that
 * stayed registered would swallow that signal.
 */

const SHUTDOWN_KEEP_ALIVE_TIMEOUT_MS = 1_000;

type Releasable = {
  onModuleDestroy?: (() => Promise<void> | void) | undefined;
};

const drains = new WeakMap<Server, Promise<void>>();

export function beginHttpDrain(server: Server): Promise<void> {
  const existing = drains.get(server);
  if (existing) {
    return existing;
  }

  // `server.close()` stops new connections and drops sockets that are
  // already idle. A socket that is still serving a response is kept, then
  // becomes a keep-alive socket when the response ends. Shorten that idle
  // timeout so it cannot hold the process open for the container grace period.
  // `headersTimeout` must stay strictly greater than `keepAliveTimeout`.
  server.keepAliveTimeout = SHUTDOWN_KEEP_ALIVE_TIMEOUT_MS;
  if (server.headersTimeout <= server.keepAliveTimeout) {
    server.headersTimeout = server.keepAliveTimeout + 1_000;
  }

  const drain = new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  drains.set(server, drain);
  return drain;
}

function waitForHttpDrain(server: Server): Promise<void> {
  return drains.get(server) ?? Promise.resolve();
}

function releaseAfterDrain(server: Server, target: Releasable): void {
  if (typeof target.onModuleDestroy !== 'function') {
    return;
  }
  const release = target.onModuleDestroy.bind(target);
  target.onModuleDestroy = async () => {
    await waitForHttpDrain(server);
    await release();
  };
}

export function installHttpDrain(
  app: { getHttpServer(): Server },
  resources: readonly Releasable[],
): void {
  const server = app.getHttpServer();
  for (const resource of resources) {
    releaseAfterDrain(server, resource);
  }

  const logger = new Logger('Shutdown');
  const onSignal = (signal: NodeJS.Signals) => {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    logger.log(`${signal}: closing the listener and draining in-flight HTTP requests`);
    beginHttpDrain(server);
  };

  process.prependListener('SIGTERM', onSignal);
  process.prependListener('SIGINT', onSignal);
}
