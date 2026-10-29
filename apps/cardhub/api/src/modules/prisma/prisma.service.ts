import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { addDbDurationMs } from '../../common/server-timing';

function observeQuery<T>(work: () => Promise<T>): Promise<T> {
  const started = process.hrtime.bigint();
  return work().finally(() => {
    addDbDurationMs(Number(process.hrtime.bigint() - started) / 1_000_000);
  });
}

function timedQuery(args: unknown, query: (args: unknown) => Promise<unknown>) {
  return observeQuery(() => query(args));
}

/**
 * Model calls and raw SQL both pass through this client. The extension records
 * only elapsed time; SQL text and parameters are not copied onto the response.
 */
function createTimedClient() {
  const logger = new Logger(PrismaService.name);
  const client = new PrismaClient().$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return timedQuery(args, query);
        },
      },
      async $queryRaw({ args, query }) {
        return timedQuery(args, query);
      },
      async $executeRaw({ args, query }) {
        return timedQuery(args, query);
      },
      async $queryRawUnsafe({ args, query }) {
        return timedQuery(args, query);
      },
      async $executeRawUnsafe({ args, query }) {
        return timedQuery(args, query);
      },
    },
  });

  return Object.assign(client, {
    async onModuleInit(): Promise<void> {
      try {
        await client.$connect();
        logger.log('Prisma connected to PostgreSQL');
      } catch (err) {
        logger.warn(
          `Prisma failed to connect (continuing anyway — start Postgres with pnpm db:up): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    async onModuleDestroy(): Promise<void> {
      await client.$disconnect();
    },
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    return createTimedClient() as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {}

  async onModuleDestroy(): Promise<void> {}
}
