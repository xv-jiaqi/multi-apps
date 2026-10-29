import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogCache, RedisCatalogCache } from './catalog-cache';
import { REDIS_CLIENT, RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => RedisService.createClient(config),
    },
    RedisService,
    RedisCatalogCache,
    { provide: CatalogCache, useExisting: RedisCatalogCache },
  ],
  exports: [RedisService, REDIS_CLIENT, CatalogCache],
})
export class RedisModule {}
