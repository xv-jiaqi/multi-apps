/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { DEMO_USERS } from './seed-data';
import { seedCatalog } from './seed-catalog';

type DemoSeedEnv = Pick<NodeJS.ProcessEnv, 'DEMO_USER_PASSWORD' | 'DEMO_ADMIN_PASSWORD'>;

function readDemoPasswords(env: DemoSeedEnv) {
  return new Map(
    DEMO_USERS.map((seed) => {
      const password = env[seed.passwordEnvVar]?.trim();
      if (!password) {
        throw new Error(
          `Missing required ${seed.passwordEnvVar}. Set it before running the demo seed for ${seed.username}.`,
        );
      }

      return [seed.username, password] as const;
    }),
  );
}

export async function seedDemo(prisma: PrismaClient, env: DemoSeedEnv = process.env) {
  const demoPasswords = readDemoPasswords(env);
  const catalogCounts = await seedCatalog(prisma);

  for (const seed of DEMO_USERS) {
    const password = await bcrypt.hash(demoPasswords.get(seed.username) ?? '', 10);
    await prisma.user.upsert({
      where: { username: seed.username },
      update: { email: seed.email, password, role: seed.role },
      create: {
        email: seed.email,
        username: seed.username,
        password,
        role: seed.role,
      },
    });
  }

  return {
    ...catalogCounts,
    users: await prisma.user.count(),
  };
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const counts = await seedDemo(prisma);
    console.log(
      `Demo seed complete. Users: ${counts.users}, Series: ${counts.series}, Cards: ${counts.cards}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
