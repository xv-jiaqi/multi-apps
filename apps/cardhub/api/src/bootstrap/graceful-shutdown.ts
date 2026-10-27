import { Logger } from '@nestjs/common';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

const drains = new WeakMap<Server, Promise<void>>();

export function beginHttpDrain(server: Server): Promise<void> {
  const existing = drains.get(server);
  if (existing) {
    return existing;
  }

  // Node >=22 closes connections that are already idle and waits for active
  // responses. installHttpDrain also closes connections as they become idle.
  const drain = new Promise<void>((resolve, reject) => {
    server.close((error?: NodeJS.ErrnoException) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  drains.set(server, drain);
  return drain;
}

/**
 * Own the signal lifecycle instead of enabling Nest's signal handlers, which
 * re-send the signal after closing. Drain HTTP before app.close() runs any
 * resource hooks (including Prisma/Redis), then exit explicitly.
 */
export function installHttpDrain(
  app: { getHttpServer(): Server; close(): Promise<void> },
  timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? DEFAULT_SHUTDOWN_TIMEOUT_MS),
): void {
  // Node timers overflow above this limit and would fire almost immediately.
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('SHUTDOWN_TIMEOUT_MS must be an integer between 1 and 2147483647');
  }

  const server = app.getHttpServer();
  const logger = new Logger('Shutdown');
  let shuttingDown = false;

  // Observe requests before the application handler can finish them. Node 22's
  // close() reaps currently idle sockets; a response active at that point may
  // later leave a keep-alive socket behind. Reap it on finish, without changing
  // keepAliveTimeout or interrupting another active response on that socket.
  server.prependListener('request', (_request: IncomingMessage, response: ServerResponse) => {
    response.once('finish', () => {
      if (shuttingDown) {
        server.closeIdleConnections();
      }
    });
  });

  const forceExit = (message: string) => {
    logger.error(message);
    server.closeAllConnections();
    process.exit(1);
  };

  const onSignal = (signal: NodeJS.Signals) => {
    // Keep both listeners installed until exit so repeated/mixed signals cannot
    // trigger the default action or start another app.close().
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.log(`${signal}: 开始 drain; closing the listener and draining in-flight HTTP requests`);

    // This is a deadline for the entire shutdown, including resource hooks.
    // Keep it referenced so hung hooks cannot exit successfully on their own.
    const deadline = setTimeout(() => {
      forceExit(`shutdown timed out after ${timeoutMs}ms; forcing remaining connections closed`);
    }, timeoutMs);

    void (async () => {
      try {
        await beginHttpDrain(server);
        logger.log(`${signal}: drain complete`);
        await app.close();
        clearTimeout(deadline);
        process.exit(0);
      } catch (error) {
        clearTimeout(deadline);
        forceExit(`shutdown failed: ${error instanceof Error ? error.stack : String(error)}`);
      }
    })();
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
