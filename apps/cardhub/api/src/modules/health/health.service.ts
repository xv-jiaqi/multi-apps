import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type HealthMetadata = {
  gitSha: string;
  buildTime: string;
};

export type HealthCheckResult = HealthMetadata & {
  status: 'ok';
  uptime: number;
  services: { db: boolean; redis: boolean };
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  metadata(): HealthMetadata {
    return {
      gitSha: process.env.GIT_SHA?.trim() || 'unknown',
      buildTime: process.env.BUILD_TIME?.trim() || 'unknown',
    };
  }

  async check(): Promise<HealthCheckResult> {
    const [db, redis] = await Promise.all([this.checkDb(), this.redis.ping()]);
    return {
      status: 'ok',
      uptime: process.uptime(),
      services: { db, redis },
      ...this.metadata(),
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
