import { fork, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Agent, createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { beginHttpDrain, installHttpDrain } from './graceful-shutdown';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function send(port: number, path = '/', agent?: Agent): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, method: 'POST', agent: agent ?? false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function startChild(timeoutMs: number | undefined, mode = 'normal') {
  const env = { ...process.env };
  if (timeoutMs === undefined) {
    delete env.SHUTDOWN_TIMEOUT_MS;
  } else {
    env.SHUTDOWN_TIMEOUT_MS = String(timeoutMs);
  }
  const child = fork(join(__dirname, '../../test/fixtures/graceful-shutdown.ts'), [mode], {
    execArgv: ['-r', require.resolve('ts-node/register/transpile-only')],
    env,
    silent: true,
  });
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  function waitForOutput(pattern: RegExp): Promise<RegExpMatchArray> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(deadline);
        child.stdout!.removeListener('data', check);
        child.stderr!.removeListener('data', check);
        child.removeListener('close', onClose);
        child.removeListener('error', onError);
      };
      const check = () => {
        const match = output.match(pattern);
        if (match) {
          cleanup();
          resolve(match);
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => onError(new Error(`Child exited before ${pattern}:\n${output}`));
      const deadline = setTimeout(() => {
        onError(new Error(`Waiting for ${pattern} timed out:\n${output}`));
      }, 5_000);
      child.stdout!.on('data', check);
      child.stderr!.on('data', check);
      child.once('close', onClose);
      child.once('error', onError);
      check();
    });
  }

  return { child, closed, waitForOutput, output: () => output };
}

describe('graceful HTTP drain', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  });

  function track(server: Server): Server {
    servers.push(server);
    return server;
  }

  it('main.ts installs the drain before listening without enabling Nest signal handlers', () => {
    const source = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    const installAt = source.indexOf('installHttpDrain(app)');
    expect(installAt).toBeGreaterThan(-1);
    expect(source.indexOf('await app.listen(')).toBeGreaterThan(installAt);
    expect(source).not.toMatch(/\bapp\.enableShutdownHooks\(/);
  });

  it('reuses the pending drain and waits for the in-flight response', async () => {
    let finishRequest: () => void = () => undefined;
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const server = track(
      createServer((_req, res) => {
        finishRequest = () => res.end('ok');
        markEntered();
      }),
    );
    const port = await listen(server);
    const pending = send(port);
    await entered;

    const drain = beginHttpDrain(server);
    expect(beginHttpDrain(server)).toBe(drain);
    expect(server.listening).toBe(false);
    let drained = false;
    void drain.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    await expect(send(port)).rejects.toMatchObject({
      code: expect.stringMatching(/ECONNREFUSED|ECONNRESET/),
    });

    finishRequest();
    await expect(pending).resolves.toEqual({ status: 200, body: 'ok' });
    await drain;
    expect(drained).toBe(true);
  });

  it('closes idle keep-alive sockets without changing connection timeouts', async () => {
    const server = track(createServer({ keepAliveTimeout: 60_000 }, (_req, res) => res.end('ok')));
    const port = await listen(server);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const headersTimeout = server.headersTimeout;
    try {
      await expect(send(port, '/', agent)).resolves.toMatchObject({ status: 200 });
      const started = Date.now();
      await beginHttpDrain(server);
      expect(Date.now() - started).toBeLessThan(1_500);
      expect(server.keepAliveTimeout).toBe(60_000);
      expect(server.headersTimeout).toBe(headersTimeout);
    } finally {
      agent.destroy();
    }
  });

  it('allows shutdown before the server has started listening', async () => {
    await expect(beginHttpDrain(track(createServer()))).resolves.toBeUndefined();
  });

  it('propagates unexpected server.close errors', async () => {
    const server = track(createServer());
    const error = new Error('close failed');
    const close = jest.spyOn(server, 'close').mockImplementationOnce((callback) => {
      callback?.(error);
      return server;
    });
    try {
      await expect(beginHttpDrain(server)).rejects.toBe(error);
    } finally {
      close.mockRestore();
    }
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])(
    'rejects invalid shutdown deadline %s before registering signal handlers',
    (timeoutMs) => {
      const server = track(createServer());
      const listeners = process.listeners('SIGTERM');
      expect(() =>
        installHttpDrain({ getHttpServer: () => server, close: jest.fn() }, timeoutMs),
      ).toThrow('SHUTDOWN_TIMEOUT_MS');
      expect(process.listeners('SIGTERM')).toEqual(listeners);
    },
  );
});

describe('graceful shutdown in a real Nest child process', () => {
  const children: ReturnType<typeof startChild>[] = [];
  const agents: Agent[] = [];

  afterEach(async () => {
    for (const agent of agents.splice(0)) {
      agent.destroy();
    }
    await Promise.all(
      children.splice(0).map(async ({ child, closed }) => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        await closed;
      }),
    );
  });

  async function start(timeoutMs: number | undefined, mode?: string) {
    const harness = startChild(timeoutMs, mode);
    children.push(harness);
    const ready = await harness.waitForOutput(/READY (\d+)/);
    return { ...harness, port: Number(ready[1]) };
  }

  function finishRequest(child: ChildProcess): void {
    child.send('finish-request');
  }

  it.each(['SIGTERM', 'SIGINT'] as const)(
    '%s drains a slow request before running all Nest hooks and exits 0 despite repeated signals',
    async (signal) => {
      const harness = await start(3_000);
      const agent = new Agent({ keepAlive: true, maxSockets: 1 });
      agents.push(agent);
      const pending = send(harness.port, '/slow', agent);
      await harness.waitForOutput(/request started/);
      const started = Date.now();
      expect(harness.child.kill(signal)).toBe(true);
      await harness.waitForOutput(/开始 drain/);
      // A second (different) signal must not restore the default exit action.
      expect(harness.child.kill(signal === 'SIGTERM' ? 'SIGINT' : 'SIGTERM')).toBe(true);
      await expect(send(harness.port)).rejects.toMatchObject({
        code: expect.stringMatching(/ECONNREFUSED|ECONNRESET/),
      });
      expect(harness.output()).not.toContain('resource destroyed');
      expect(harness.output()).not.toContain('drain complete');

      finishRequest(harness.child);
      await expect(pending).resolves.toEqual({ status: 200, body: 'ok' });
      await expect(harness.closed).resolves.toEqual({ code: 0, signal: null });
      expect(Date.now() - started).toBeLessThan(3_000);
      const output = harness.output();
      const markers = [
        '开始 drain',
        'request finished with resources available',
        'drain complete',
        'resource destroyed',
        'before application shutdown',
        'application shutdown complete',
      ];
      const positions = markers.map((marker) => output.indexOf(marker));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(output.match(/开始 drain/g)).toHaveLength(1);
      expect(output.match(/resource destroyed/g)).toHaveLength(1);
    },
  );

  it('uses the default deadline and exits 0 when there are no in-flight requests', async () => {
    const harness = await start(undefined);
    harness.child.kill('SIGTERM');
    await expect(harness.closed).resolves.toEqual({ code: 0, signal: null });
    expect(harness.output()).toContain('drain complete');
    expect(harness.output()).toContain('application shutdown complete');
  });

  it('force-closes a request that exceeds the configured deadline and exits 1 with a timeout log', async () => {
    const harness = await start(300);
    // Observe rejection immediately: the child will deliberately reset this connection.
    const pending = send(harness.port, '/slow').then(
      (response) => ({ response, error: undefined }),
      (error: NodeJS.ErrnoException) => ({ response: undefined, error }),
    );
    await harness.waitForOutput(/request started/);
    const started = Date.now();
    harness.child.kill('SIGTERM');
    await expect(harness.closed).resolves.toEqual({ code: 1, signal: null });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(Date.now() - started).toBeLessThan(2_000);
    const outcome = await pending;
    expect(outcome.response).toBeUndefined();
    expect(outcome.error?.code).toMatch(/ECONNRESET|EPIPE/);
    expect(harness.output()).toContain('开始 drain');
    expect(harness.output()).toContain('shutdown timed out after 300ms');
    expect(harness.output()).not.toContain('drain complete');
    expect(harness.output()).not.toContain('resource destroyed');
  });

  it('keeps the deadline active while a resource shutdown hook hangs', async () => {
    const harness = await start(300, 'close-hang');
    harness.child.kill('SIGTERM');
    await expect(harness.closed).resolves.toEqual({ code: 1, signal: null });
    expect(harness.output()).toContain('drain complete');
    expect(harness.output()).toContain('resource destroyed');
    expect(harness.output()).toContain('shutdown timed out after 300ms');
    expect(harness.output()).not.toContain('application shutdown complete');
  });

  it('logs a resource shutdown failure and exits 1', async () => {
    const harness = await start(3_000, 'close-error');
    harness.child.kill('SIGTERM');
    await expect(harness.closed).resolves.toEqual({ code: 1, signal: null });
    expect(harness.output()).toContain('drain complete');
    expect(harness.output()).toContain('shutdown failed: Error: resource close failed');
    expect(harness.output()).not.toContain('application shutdown complete');
  });
});
