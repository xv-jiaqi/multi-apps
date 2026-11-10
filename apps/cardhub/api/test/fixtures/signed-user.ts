import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

export type SignedUser = { id: string; token: string };

/**
 * A user row plus a token the real context accepts. Skips auth.register so a
 * rate-limit test does not spend the authMutation IP bucket on setup.
 */
export async function createSignedUser(
  app: INestApplication,
  options: { banned?: boolean } = {},
): Promise<SignedUser> {
  const prisma = app.get(PrismaService);
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const user = await prisma.user.create({
    data: {
      email: `rl-${suffix}@cardhub.test`,
      username: `rl${suffix}`,
      password: 'not-a-real-hash',
      ...(options.banned ? { bannedAt: new Date() } : {}),
    },
  });
  const token = app.get(AuthService).sign({ sub: user.id, username: user.username, ver: 0 });
  return { id: user.id, token };
}
