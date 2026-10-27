import { readFileSync } from 'node:fs';
import { Agent, createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { beginHttpDrain, installHttpDrain } from './graceful-shutdown';

type ReleaseSpy = {
  onModuleDestroy: () => Promise<void>;
  released: () => boolean;
};

function releaseSpy(): ReleaseSpy {
  let released = false;
  return {
    released: () => released,
    async onModuleDestroy() {
      released = true;
    },
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function send(
  port: number,
  method: string,
  path: string,
  agent?: Agent,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function listenerSet(signal: NodeJS.Signals): Set<unknown> {
  return new Set(process.listeners(signal));
}

function addedListeners(signal: NodeJS.Signals, before: Set<unknown>): readonly unknown[] {
  return process.listeners(signal).filter((listener) => !before.has(listener));
}

describe('graceful HTTP drain', () => {
  const servers: Server[] = [];
  const cleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  function track(server: Server): Server {
    servers.push(server);
    return server;
  }

  function trackSignals(): void {
    const term = listenerSet('SIGTERM');
    const intr = listenerSet('SIGINT');
    cleanups.push(() => {
      for (const listener of process.listeners('SIGTERM')) {
        if (!term.has(listener)) {
          process.removeListener('SIGTERM', listener);
        }
      }
      for (const listener of process.listeners('SIGINT')) {
        if (!intr.has(listener)) {
          process.removeListener('SIGINT', listener);
        }
      }
    });
  }

  it('main.ts calls enableShutdownHooks before the process listens', () => {
    const source = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    const shutdown = source.indexOf('app.enableShutdownHooks()');
    const listenAt = source.indexOf('await app.listen(');
    expect(shutdown).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(shutdown);
    expect(source).toContain(
      'installHttpDrain(app, [app.get(PrismaService), app.get(RedisService)])',
    );
  });

  it('returns 200 for an in-flight POST and releases resources only after that', async () => {
    const resource = releaseSpy();
    const other = releaseSpy();
    let sawReleasedDuringHandler = true;
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const server = track(
      createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        markEntered();
        void gate.then(() => {
          sawReleasedDuringHandler = resource.released() || other.released();
          res.end('ok');
        });
      }),
    );
    const port = await listen(server);
    trackSignals();
    installHttpDrain({ getHttpServer: () => server }, [resource, other]);

    const pending = send(port, 'POST', '/slow');
    await entered;
    process.emit('SIGTERM', 'SIGTERM');
    expect(resource.released()).toBe(false);
    expect(other.released()).toBe(false);

    const release = Promise.all([resource.onModuleDestroy(), other.onModuleDestroy()]);
    openGate();
    const response = await pending;
    await release;

    expect(response).toEqual({ status: 200, body: 'ok' });
    expect(sawReleasedDuringHandler).toBe(false);
    expect(resource.released()).toBe(true);
    expect(other.released()).toBe(true);
  });

  it('refuses a new connection once the drain has started', async () => {
    const server = track(
      createServer((_req, res) => {
        res.writeHead(200);
        res.end('ok');
      }),
    );
    const port = await listen(server);
    beginHttpDrain(server);

    await expect(send(port, 'GET', '/')).rejects.toMatchObject({
      code: expect.stringMatching(/ECONNREFUSED|ECONNRESET/),
    });
  });

  it('does not let an idle keep-alive socket hold the drain open', async () => {
    const server = track(
      createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      }),
    );
    const port = await listen(server);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      await expect(send(port, 'GET', '/', agent)).resolves.toMatchObject({ status: 200 });
      const started = Date.now();
      await beginHttpDrain(server);
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      agent.destroy();
    }
  });

  it('shortens keep-alive on shutdown and keeps headersTimeout above it', async () => {
    const server = track(createServer());
    await listen(server);
    const originalHeadersTimeout = server.headersTimeout;

    beginHttpDrain(server);

    expect(server.keepAliveTimeout).toBe(1_000);
    expect(server.headersTimeout).toBe(originalHeadersTimeout);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });

  it('raises headersTimeout when it is not above the shutdown keep-alive timeout', async () => {
    const server = track(createServer());
    await listen(server);
    server.headersTimeout = 500;

    beginHttpDrain(server);

    expect(server.keepAliveTimeout).toBe(1_000);
    expect(server.headersTimeout).toBe(2_000);
  });

  it('registers one SIGTERM and SIGINT listener and drops it after the signal', async () => {
    const server = track(createServer());
    await listen(server);
    const beforeTerm = listenerSet('SIGTERM');
    const beforeInt = listenerSet('SIGINT');
    trackSignals();
    installHttpDrain({ getHttpServer: () => server }, [{}]);

    const addedTerm = addedListeners('SIGTERM', beforeTerm);
    const addedInt = addedListeners('SIGINT', beforeInt);
    expect(addedTerm).toHaveLength(1);
    expect(addedInt).toEqual(addedTerm);

    process.emit('SIGINT', 'SIGINT');

    expect(addedListeners('SIGTERM', beforeTerm)).toHaveLength(0);
    expect(addedListeners('SIGINT', beforeInt)).toHaveLength(0);
  });
});
