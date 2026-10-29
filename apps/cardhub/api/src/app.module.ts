import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { SeoModule } from './modules/seo/seo.module';
import { AuthModule } from './modules/auth/auth.module';
import { TrpcModule } from './trpc/trpc.module';
import { validateEnv } from './config/env.validation';
import { appLogStream, createHttpLoggerOptions } from './bootstrap/http-logger';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    // Register once. forRoutes stays empty: createApp mounts the one pino-http
    // middleware before the body parser. A second mount logs every request twice.
    LoggerModule.forRoot({
      forRoutes: [],
      pinoHttp: [createHttpLoggerOptions(), appLogStream],
    }),
    // Global throttler defaults: 60 req/min/IP. Only NestJS controllers go
    // through this guard; tRPC routes are throttled by express-rate-limit
    // wired in main.ts. Both layers stay so future REST endpoints inherit
    // the limit automatically.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 60,
      },
    ]),
    PrismaModule,
    RedisModule,
    AuthModule,
    HealthModule,
    SeoModule,
    TrpcModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
