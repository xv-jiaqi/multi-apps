/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { DEMO_USERS } from './seed-data';
import { seedCatalog } from './seed-catalog';

export async function seedDemo(prisma: PrismaClient) {
  const catalogCounts = await seedCatalog(prisma);

  for (const seed of DEMO_USERS) {
    const password = await bcrypt.hash(seed.rawPassword, 10);
    await prisma.user.upsert({
      where: { username: seed.username },
      update: { role: seed.role },
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
    console.log(`Demo seed complete. Users: ${counts.users}, Series: ${counts.series}, Cards: ${counts.cards}`);
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
