import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SCOPES, type Scope } from '@agent-hub/contract';
import type { HubPaths } from '../common/paths';
import { appendAudit } from '../db/repositories/audit.repo';
import {
  findActiveTokenByHash,
  findDefaultToken,
  getTokenById,
  insertToken,
  listTokens,
  revokeToken,
  rowToTokenDto,
  touchLastUsed,
  updateTokenScopes,
} from '../db/repositories/tokens.repo';
import type { Db } from '../db/sqlite';
import { fromJson } from '../db/sqlite';
import { ApiError } from '../api/api-error';
import { TokenBuckets } from './rate-limit';
import {
  BRIDGE_TOKEN_PREFIX,
  UI_TOKEN_PREFIX,
  generateToken,
  hashToken,
  safeEqual,
  tokenDisplayPrefix,
} from './tokens';
import { UI_PRINCIPAL, type Principal } from './principal';

@Injectable()
export class AuthService {
  private uiToken = '';
  private readonly lastUsedWriteAt = new Map<string, number>();
  private readonly buckets = new TokenBuckets();
  readonly events = new EventEmitter();

  constructor(
    private readonly db: Db,
    private readonly paths: HubPaths,
  ) {}

  /** 启动时生成 UI token。 */
  bootstrapUiToken(): string {
    this.uiToken = generateToken(UI_TOKEN_PREFIX);
    return this.uiToken;
  }

  getUiToken(): string {
    return this.uiToken;
  }

  authenticate(token: string): Principal | null {
    if (token.startsWith(UI_TOKEN_PREFIX)) {
      if (!this.uiToken || !safeEqual(token, this.uiToken)) return null;
      return UI_PRINCIPAL;
    }
    if (!token.startsWith(BRIDGE_TOKEN_PREFIX)) return null;
    const row = findActiveTokenByHash(this.db, hashToken(token));
    if (!row) return null;
    const now = Date.now();
    const prev = this.lastUsedWriteAt.get(row.id) ?? 0;
    if (now - prev >= 60_000) {
      touchLastUsed(this.db, row.id, new Date(now).toISOString());
      this.lastUsedWriteAt.set(row.id, now);
    }
    return {
      kind: 'bridge',
      tokenId: row.id,
      scopes: fromJson<Scope[]>(row.scopes) ?? [],
      admin: false,
    };
  }

  takeRateToken(tokenId: string): boolean {
    return this.buckets.take(tokenId);
  }

  /**
   * 默认桥接 token 四条规则（local-api §2.2）。
   */
  ensureDefaultToken(): void {
    mkdirSync(this.paths.home, { recursive: true, mode: 0o700 });
    const current = findDefaultToken(this.db);
    const fileToken = this.readBridgeTokenFile();

    if (!current) {
      this.createBridgeTokenInternal({
        name: '本地郎（默认）',
        scopes: ['tasks:read', 'tasks:write'],
        isDefault: true,
        writeFile: true,
      });
      return;
    }

    if (current.revoked_at) {
      if (existsSync(this.paths.bridgeToken)) {
        try {
          unlinkSync(this.paths.bridgeToken);
        } catch {
          // ignore
        }
      }
      return;
    }

    if (fileToken && hashToken(fileToken) === current.token_hash) {
      return;
    }

    // 明文找不回来：轮换
    this.revoke(current.id, 'system');
    this.createBridgeTokenInternal({
      name: '本地郎（默认）',
      scopes: ['tasks:read', 'tasks:write'],
      isDefault: true,
      writeFile: true,
    });
  }

  list(): ReturnType<typeof listTokens> {
    return listTokens(this.db);
  }

  create(
    name: string,
    scopes: readonly Scope[],
  ): { dto: ReturnType<typeof rowToTokenDto>; token: string } {
    return this.createBridgeTokenInternal({ name, scopes, isDefault: false, writeFile: false });
  }

  revoke(tokenId: string, actor: string = 'ui'): ReturnType<typeof rowToTokenDto> {
    const before = getTokenById(this.db, tokenId);
    if (!before || before.revoked_at) throw new ApiError('TOKEN_NOT_FOUND', 'token 不存在或已吊销');
    const row = revokeToken(this.db, tokenId, new Date().toISOString());
    if (!row) throw new ApiError('TOKEN_NOT_FOUND', 'token 不存在或已吊销');
    appendAudit(this.db, {
      actor,
      action: 'token.revoked',
      detail: { tokenId },
    });
    if (row.is_default && existsSync(this.paths.bridgeToken)) {
      try {
        unlinkSync(this.paths.bridgeToken);
      } catch {
        // ignore
      }
    }
    this.events.emit('tokenChanged', { tokenId, revoked: true });
    return rowToTokenDto(row);
  }

  updateScopes(tokenId: string, scopes: readonly Scope[]): ReturnType<typeof rowToTokenDto> {
    const before = getTokenById(this.db, tokenId);
    if (!before || before.revoked_at) throw new ApiError('TOKEN_NOT_FOUND', 'token 不存在或已吊销');
    const from = fromJson<Scope[]>(before.scopes) ?? [];
    const row = updateTokenScopes(this.db, tokenId, scopes);
    if (!row) throw new ApiError('TOKEN_NOT_FOUND', 'token 不存在或已吊销');
    appendAudit(this.db, {
      actor: 'ui',
      action: 'token.scopes_changed',
      detail: { tokenId, from, to: scopes },
    });
    const lostRead = from.includes('tasks:read') && !scopes.includes('tasks:read');
    this.events.emit('tokenChanged', { tokenId, revoked: false, lostRead });
    return rowToTokenDto(row);
  }

  rotateDefault(): { dto: ReturnType<typeof rowToTokenDto>; token: string } {
    const current = findDefaultToken(this.db);
    if (current && !current.revoked_at) {
      this.revoke(current.id, 'ui');
    }
    return this.createBridgeTokenInternal({
      name: '本地郎（默认）',
      scopes: ['tasks:read', 'tasks:write'],
      isDefault: true,
      writeFile: true,
    });
  }

  private createBridgeTokenInternal(opts: {
    name: string;
    scopes: readonly Scope[];
    isDefault: boolean;
    writeFile: boolean;
  }): { dto: ReturnType<typeof rowToTokenDto>; token: string } {
    const token = generateToken(BRIDGE_TOKEN_PREFIX);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    insertToken(this.db, {
      id,
      name: opts.name,
      tokenHash: hashToken(token),
      tokenPrefix: tokenDisplayPrefix(token),
      scopes: opts.scopes,
      isDefault: opts.isDefault,
      createdAt,
    });
    appendAudit(this.db, {
      actor: 'system',
      action: 'token.created',
      detail: { tokenId: id, name: opts.name, scopes: opts.scopes },
    });
    if (opts.writeFile) this.writeBridgeTokenFile(token);
    const row = getTokenById(this.db, id)!;
    return { dto: rowToTokenDto(row), token };
  }

  private readBridgeTokenFile(): string | null {
    try {
      const raw = readFileSync(this.paths.bridgeToken, 'utf8').trim();
      return raw || null;
    } catch {
      return null;
    }
  }

  private writeBridgeTokenFile(token: string): void {
    const tmp = `${this.paths.bridgeToken}.tmp`;
    writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
    renameSync(tmp, this.paths.bridgeToken);
    chmodSync(this.paths.bridgeToken, 0o600);
  }
}

export type { Scope };
export { SCOPES };
