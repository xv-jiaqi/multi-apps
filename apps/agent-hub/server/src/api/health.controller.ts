import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@agent-hub/contract';
import { Public } from './access';
import { SERVER_VERSION } from '../version';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health(): HealthResponse {
    return { app: 'agent-hub', version: SERVER_VERSION };
  }
}
