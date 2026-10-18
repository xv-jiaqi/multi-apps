import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface JwtPayload {
  sub: string;
  username: string;
  /** Absent on tokens issued before tokenVersion shipped. Callers treat that as 0. */
  ver?: number;
}

export class InvalidAuthTokenError extends Error {
  constructor() {
    super('Invalid auth token');
    this.name = 'InvalidAuthTokenError';
  }
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!('sub' in value) || typeof value.sub !== 'string' || value.sub.length === 0) return false;
  if (!('username' in value) || typeof value.username !== 'string') return false;
  if ('ver' in value && value.ver !== undefined && typeof value.ver !== 'number') return false;
  return true;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: JwtPayload & { ver: number }): string {
    return this.jwt.sign(payload);
  }

  verify(token: string): JwtPayload {
    let decoded: unknown;
    try {
      decoded = this.jwt.verify(token);
    } catch {
      throw new InvalidAuthTokenError();
    }
    if (!isJwtPayload(decoded)) throw new InvalidAuthTokenError();
    return decoded;
  }
}
