import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { utcCalendarDateFromInstant } from '@repo/shared';
import type { PrismaService } from '../prisma/prisma.service';

const activityLogger = new Logger('UserDailyActivity');

function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return 'unknown';
}

/**
 * Insert one activity row for this UTC day. A repeat the same day is a no-op.
 * Any failure is logged and swallowed so the caller's request still finishes.
 */
export async function recordDailyActivity(
  prisma: PrismaService,
  userId: string,
  options?: {
    now?: Date;
    warn?: (code: string) => void;
  },
): Promise<void> {
  const day = utcCalendarDateFromInstant(options?.now ?? new Date());
  try {
    await prisma.userDailyActivity.createMany({
      data: [{ userId, day }],
      skipDuplicates: true,
    });
  } catch (error) {
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
