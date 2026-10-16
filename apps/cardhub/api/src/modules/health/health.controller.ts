import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService, type HealthCheckResult } from './health.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResult> {
    const result = await this.health.check();
    if (!result.services.db) {
      res.status(503);
    }
    return result;
  }
}
