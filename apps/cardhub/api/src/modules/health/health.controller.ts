import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<{
    status: 'ok';
    uptime: number;
    services: { db: boolean; redis: boolean };
  }> {
    const [db, redis] = await Promise.all([this.checkDb(), this.redis.ping()]);
    return {
      status: 'ok',
      uptime: process.uptime(),
      services: { db, redis },
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
