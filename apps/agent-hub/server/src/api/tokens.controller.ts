import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createTokenBodySchema,
  updateTokenBodySchema,
  type ApiTokenDto,
  type CreatedApiTokenDto,
  type ItemsResponse,
} from '@agent-hub/contract';
import { AuthService } from '../auth/auth.service';
import { parseInput } from './api-error';

/** 管理接口：默认只认 UI token（无 @Scopes / @Public）。 */
@Controller('tokens')
export class TokensController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list(): ItemsResponse<ApiTokenDto> {
    return { items: this.auth.list() };
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown): CreatedApiTokenDto {
    const input = parseInput(createTokenBodySchema, body);
    const { dto, token } = this.auth.create(input.name, input.scopes);
    return { ...dto, token };
  }

  @Post('rotate-default')
  @HttpCode(201)
  rotateDefault(): CreatedApiTokenDto {
    const { dto, token } = this.auth.rotateDefault();
    return { ...dto, token };
  }

  @Patch(':tokenId')
  update(@Param('tokenId') tokenId: string, @Body() body: unknown): ApiTokenDto {
    const input = parseInput(updateTokenBodySchema, body);
    return this.auth.updateScopes(tokenId, input.scopes);
  }

  @Post(':tokenId/revoke')
  revoke(@Param('tokenId') tokenId: string): ApiTokenDto {
    return this.auth.revoke(tokenId, 'ui');
  }
}
