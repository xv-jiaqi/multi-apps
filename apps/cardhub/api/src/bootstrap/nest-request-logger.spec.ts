jest.mock('@sentry/node', () => {
  const actual = jest.requireActual('@sentry/node');
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    throw new Error('@sentry/node mock expected an object');
  }
  return {
    ...actual,
    captureException: jest.fn(() => 'event-id'),
  };
});

import 'reflect-metadata';
import { PassThrough } from 'node:stream';
import { Controller, Get, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LoggerModule, NativeLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import request from 'supertest';
import { z } from 'zod';
import { SentryExceptionFilter } from '../common/sentry-exception.filter';
import { attachLogLineReader, attachRequestLogging, createHttpLoggerOptions } from './http-logger';

const stream = new PassThrough();
const lines: string[] = [];
attachLogLineReader(stream, (line) => {
  if (line.length > 0) lines.push(line);
});

@Controller('probe')
class ProbeController {
  @Get('boom')
  boom(): void {
    new Logger('Probe').log('probe-line');
    throw new Error('probe-boom');
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      forRoutes: [],
      pinoHttp: [createHttpLoggerOptions(), stream],
    }),
  ],
  controllers: [ProbeController],
})
class ProbeModule {}

const logLineSchema = z.looseObject({
  requestId: z.string().nullable().optional(),
  message: z.unknown().optional(),
});

describe('Nest request logger', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;

  beforeAll(async () => {
    app = await NestFactory.create(ProbeModule, { bufferLogs: true, bodyParser: false });
    app.useLogger(app.get(NativeLogger));
    app.flushLogs();
    attachRequestLogging(app, stream);
    app.useGlobalFilters(new SentryExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('puts the request id on Nest log lines and the Sentry event for a 500', async () => {
    const capture = jest.mocked(Sentry.captureException);
    capture.mockClear();
    const response = await request(app.getHttpServer())
      .get('/probe/boom')
      .set('X-Request-Id', 'probe-1');

    expect(response.status).toBe(500);
    expect(response.headers['x-request-id']).toBe('probe-1');
    expect(JSON.stringify(response.body)).not.toContain('probe-boom');
    expect(capture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ request_id: 'probe-1' }),
      }),
    );

    const probeLines = lines.filter(
      (line) => line.includes('probe-line') || line.includes('probe-boom'),
    );
    expect(probeLines.length).toBeGreaterThan(0);
    for (const line of probeLines) {
      expect(line.split('"requestId":').length - 1).toBe(1);
      expect(line).toContain('"requestId":"probe-1"');
      expect(line).not.toContain('"requestId":null');
    }

    const parsed = probeLines.map((line) => logLineSchema.parse(JSON.parse(line)));
    expect(parsed.find((line) => line.message === 'probe-line')?.requestId).toBe('probe-1');
    expect(parsed.find((line) => line.message === 'probe-boom')?.requestId).toBe('probe-1');
  });
});
