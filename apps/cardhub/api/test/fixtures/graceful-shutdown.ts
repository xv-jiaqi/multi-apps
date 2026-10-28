import 'reflect-metadata';
import { Controller, HttpCode, Injectable, Logger, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { installHttpDrain } from '../../src/bootstrap/graceful-shutdown';

const logger = new Logger('ShutdownFixture');
let resourceDestroyed = false;
let finishRequest: (() => void) | undefined;

process.on('message', (message: unknown) => {
  if (message === 'finish-request') {
    finishRequest?.();
  }
});

@Injectable()
class ShutdownResource {
  async onModuleDestroy(): Promise<void> {
    resourceDestroyed = true;
    logger.log('resource destroyed');
    if (process.argv[2] === 'close-error') {
      throw new Error('resource close failed');
    }
    if (process.argv[2] === 'close-hang') {
      await new Promise<void>(() => undefined);
    }
  }

  beforeApplicationShutdown(): void {
    logger.log('before application shutdown');
  }

  onApplicationShutdown(): void {
    logger.log('application shutdown complete');
  }
}

@Controller()
class SlowController {
  @Post('slow')
  @HttpCode(200)
  async slow(): Promise<string> {
    const gate = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    logger.log('request started');
    await gate;
    if (resourceDestroyed) {
      throw new Error('resources released before request completed');
    }
    logger.log('request finished with resources available');
    return 'ok';
  }
}

@Module({ controllers: [SlowController], providers: [ShutdownResource] })
class ShutdownTestModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ShutdownTestModule);
  // A completing keep-alive request must drain without waiting for this idle timeout.
  app.getHttpServer().keepAliveTimeout = 60_000;
  installHttpDrain(app);
  await app.listen(0, '127.0.0.1');
  process.stdout.write(`READY ${(app.getHttpServer().address() as AddressInfo).port}\n`);
}

void bootstrap().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});
