import type { INestApplication } from '@nestjs/common';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { RedisService } from '../src/modules/redis/redis.service';

/**
 * Speaks just enough RESP for ioredis to mark the socket ready, then can stop
 * answering while keeping the TCP connection open.
 */
function startAnswerThenSilence(): Promise<{
  port: number;
  silence: () => void;
  close: () => Promise<void>;
}> {
  let silent = false;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const drained = drainCommands(buffer);
      buffer = drained.rest;
      if (silent) return;
      for (let i = 0; i < drained.count; i += 1) socket.write('+OK\r\n');
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('silent redis did not bind a port'));
        return;
      }
      resolve({
        port: address.port,
        silence: () => {
          silent = true;
        },
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

function drainCommands(input: Buffer): { count: number; rest: Buffer } {
  let offset = 0;
  let count = 0;
  while (offset < input.length) {
    const next = readCommand(input, offset);
    if (!next) break;
    offset = next;
    count += 1;
  }
  return { count, rest: input.subarray(offset) };
}

function readCommand(input: Buffer, offset: number): number | null {
  if (input[offset] !== 42) return null;
  const header = readLine(input, offset);
  if (!header) return null;
  const argc = Number(header.text);
  if (!Number.isInteger(argc) || argc < 0) return null;
  let cursor = header.next;
  for (let i = 0; i < argc; i += 1) {
    if (input[cursor] !== 36) return null;
    const lenLine = readLine(input, cursor);
    if (!lenLine) return null;
    const len = Number(lenLine.text);
    if (!Number.isInteger(len) || len < 0) return null;
    const dataEnd = lenLine.next + len;
    if (input.length < dataEnd + 2) return null;
    cursor = dataEnd + 2;
  }
  return cursor;
}

function readLine(input: Buffer, offset: number): { text: string; next: number } | null {
  const end = input.indexOf('\r\n', offset);
  if (end < 0) return null;
  return { text: input.toString('utf8', offset + 1, end), next: end + 2 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('Redis stays silent after the handshake', () => {
  jest.setTimeout(60_000);

  const previousHost = process.env.REDIS_HOST;
  const previousPort = process.env.REDIS_PORT;
  let app: INestApplication | undefined;
  let server: { close: () => Promise<void> } | undefined;

  afterAll(async () => {
    if (app) await app.close();
    if (server) await server.close();
    if (previousHost === undefined) delete process.env.REDIS_HOST;
    else process.env.REDIS_HOST = previousHost;
    if (previousPort === undefined) delete process.env.REDIS_PORT;
    else process.env.REDIS_PORT = previousPort;
  });

  it('keeps authenticated requests under 300ms and still writes the activity row', async () => {
    const fake = await startAnswerThenSilence();
    server = fake;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(fake.port);

    app = await createApp();
    await app.init();
    const prisma = app.get(PrismaService);
    const redis = app.get(RedisService);
    expect(redis.client.status).toBe('ready');

    const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`.replace(
      /[^a-z0-9]/gi,
      '',
    );
    const registered = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.90')
      .send({
        email: `silent-${suffix}@cardhub.test`,
        username: `silent${suffix}`.slice(0, 24),
        password: 'silent-password',
      });
    expect(registered.status).toBe(200);
    const data = registered.body?.result?.data;
    if (!isRecord(data) || !isRecord(data.user) || typeof data.token !== 'string') {
      throw new Error('expected a registered session');
    }
    const userId = data.user.id;
    if (typeof userId !== 'string') throw new Error('expected a user id');
    const token = data.token;

    fake.silence();

    const paths = ['users.me', 'collection.progress', 'series.list'] as const;
    for (const path of paths) {
      const started = Date.now();
      const response = await request(app.getHttpServer())
        .get(`/trpc/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .query(path === 'series.list' ? { input: JSON.stringify({}) } : {});
      const elapsed = Date.now() - started;
      expect(response.status).toBe(200);
      if (elapsed >= 300) throw new Error(`${path} took ${elapsed}ms`);
      if (path === 'series.list') {
        const list = response.body?.result?.data;
        expect(Array.isArray(list?.items)).toBe(true);
      }
      if (path === 'users.me') {
        expect(response.body?.result?.data?.id).toBe(userId);
      }
    }

    const loginStarted = Date.now();
    const login = await request(app.getHttpServer())
      .post('/trpc/auth.login')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', '203.0.113.91')
      .send({ email: `missing-${suffix}@cardhub.test`, password: 'silent-password' });
    const loginElapsed = Date.now() - loginStarted;
    expect(login.status).toBeLessThan(500);
    if (loginElapsed >= 300) throw new Error(`auth.login took ${loginElapsed}ms`);

    const deadline = Date.now() + 1_000;
    let activity = 0;
    while (Date.now() < deadline) {
      activity = await prisma.userDailyActivity.count({ where: { userId } });
      if (activity > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(activity).toBeGreaterThan(0);

    await prisma.userDailyActivity.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });
});
