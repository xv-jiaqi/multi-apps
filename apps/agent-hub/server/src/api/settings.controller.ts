import { Controller, Get, Inject } from '@nestjs/common';
import type { SettingsResponse } from '@agent-hub/contract';
import { HUB_PATHS, type HubPaths } from '../common/paths';
import { HubConfigService } from '../config/config.service';

/** PR1：只读 settings；PUT（含仓库体检）留给后续。 */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly config: HubConfigService,
    @Inject(HUB_PATHS) private readonly paths: HubPaths,
  ) {}

  @Get()
  get(): SettingsResponse {
    return {
      config: this.config.get(),
      restartRequired: false,
      dataDir: this.paths.home,
      bridgeTokenFile: this.paths.bridgeToken,
    };
  }
}
