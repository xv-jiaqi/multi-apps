import type { ApiTokenDto, Scope } from '@agent-hub/contract';
import { fromBool, fromJson, toBool, toJson, type Db } from '../sqlite';

export interface TokenRow {
  id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  is_default: number;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function rowToTokenDto(row: TokenRow): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: fromJson<Scope[]>(row.scopes) ?? [],
    isDefault: toBool(row.is_default),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export function findActiveTokenByHash(db: Db, tokenHash: string): TokenRow | undefined {
  return db.get<TokenRow>(
    `SELECT * FROM api_tokens WHERE token_hash = :hash AND revoked_at IS NULL`,
    { hash: tokenHash },
  );
}

export function findDefaultToken(db: Db): TokenRow | undefined {
  return db.get<TokenRow>(
    `SELECT * FROM api_tokens WHERE is_default = 1 ORDER BY created_at DESC LIMIT 1`,
  );
}

export function listTokens(db: Db): ApiTokenDto[] {
  return db.all<TokenRow>(`SELECT * FROM api_tokens ORDER BY created_at DESC`).map(rowToTokenDto);
}

export function getTokenById(db: Db, id: string): TokenRow | undefined {
  return db.get<TokenRow>(`SELECT * FROM api_tokens WHERE id = :id`, { id });
}

export function insertToken(
  db: Db,
  row: {
    id: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    scopes: readonly Scope[];
    isDefault: boolean;
    createdAt: string;
  },
): void {
  db.run(
    `INSERT INTO api_tokens
      (id, name, token_hash, token_prefix, scopes, is_default, created_at, last_used_at, revoked_at)
     VALUES
      (:id, :name, :token_hash, :token_prefix, :scopes, :is_default, :created_at, NULL, NULL)`,
    {
      id: row.id,
      name: row.name,
      token_hash: row.tokenHash,
      token_prefix: row.tokenPrefix,
      scopes: toJson(row.scopes)!,
      is_default: fromBool(row.isDefault),
      created_at: row.createdAt,
    },
  );
}

export function revokeToken(db: Db, id: string, revokedAt: string): TokenRow | undefined {
  db.run(
    `UPDATE api_tokens SET revoked_at = :revoked_at
     WHERE id = :id AND revoked_at IS NULL`,
    { id, revoked_at: revokedAt },
  );
  return getTokenById(db, id);
}

export function updateTokenScopes(
  db: Db,
  id: string,
  scopes: readonly Scope[],
): TokenRow | undefined {
  db.run(`UPDATE api_tokens SET scopes = :scopes WHERE id = :id AND revoked_at IS NULL`, {
    id,
    scopes: toJson(scopes)!,
  });
  return getTokenById(db, id);
}

export function touchLastUsed(db: Db, id: string, at: string): void {
  db.run(`UPDATE api_tokens SET last_used_at = :at WHERE id = :id`, { id, at });
}
