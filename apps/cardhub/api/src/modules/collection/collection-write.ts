import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

/**
 * One retry after a unique-index clash. Prisma upsert is normally one
 * INSERT ... ON CONFLICT. Two first writes of the same card can still surface
 * P2002; the second attempt updates the row that won the race.
 */
export async function retryUniqueConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }
  return write();
}
