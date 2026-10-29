import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatUtcCalendarDate, utcCalendarDateFromInstant } from '@repo/shared';
import type { PrismaService } from '../prisma/prisma.service';

const activityLogger = new Logger('UserDailyActivity');

/** Not under `cardhub:cache:v1:`, so a catalog cache purge does not clear it. */
export const DAILY_ACTIVITY_KEY_PREFIX = 'cardhub:activity:v1:';

export interface DailyActivityRedis {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    mode: 'NX',
  ): Promise<'OK' | null>;
  del?(key: string): Promise<unknown>;
}

/** Seconds until the next UTC midnight. At least 1 so EX never gets 0. */
export function secondsUntilNextUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return 'unknown';
}

async function claimUtcDay(
  redis: DailyActivityRedis | undefined,
  userId: string,
  day: string,
  ttlSeconds: number,
): Promise<'claimed' | 'seen' | 'unavailable'> {
  if (!redis) return 'unavailable';
  try {
    const result = await redis.set(
      `${DAILY_ACTIVITY_KEY_PREFIX}${userId}:${day}`,
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    if (result === 'OK') return 'claimed';
    if (result === null) return 'seen';
    return 'unavailable';
  } catch {
    activityLogger.warn('daily activity lock unavailable');
    return 'unavailable';
  }
}

/**
 * Insert one activity row for this UTC day. Redis SET NX with EX until the
 * next UTC midnight skips the database write after the first claim. Redis
 * errors fall through to the insert. A database failure is logged and
 * swallowed so the caller's request still finishes.
 */
export async function recordDailyActivity(
  prisma: PrismaService,
  userId: string,
  options?: {
    now?: Date;
    warn?: (code: string) => void;
    redis?: DailyActivityRedis;
  },
): Promise<void> {
  const now = options?.now ?? new Date();
  const day = utcCalendarDateFromInstant(now);
  const claim = await claimUtcDay(
    options?.redis,
    userId,
    formatUtcCalendarDate(day),
    secondsUntilNextUtcMidnight(now),
  );
  if (claim === 'seen') return;

  const dayIso = formatUtcCalendarDate(day);
  try {
    await prisma.userDailyActivity.createMany({
      data: [{ userId, day }],
      skipDuplicates: true,
    });
  } catch (error) {
    if (claim === 'claimed') {
      try {
        await options?.redis?.del?.(`${DAILY_ACTIVITY_KEY_PREFIX}${userId}:${dayIso}`);
      } catch {
        activityLogger.warn('daily activity lock release failed');
      }
    }
    const code = errorCode(error);
    try {
      if (options?.warn) {
        options.warn(code);
      } else {
        activityLogger.warn(`daily activity write failed (${code})`);
      }
    } catch {
      activityLogger.warn(`daily activity write failed (${code})`);
    }
  }
}
