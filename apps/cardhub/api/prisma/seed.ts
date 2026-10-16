/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

import { seedDemo } from '../src/scripts/seed-demo';

const prisma = new PrismaClient();

seedDemo(prisma)
  .then((counts) => {
    console.log(`Seed complete. Users: ${counts.users}, Series: ${counts.series}, Cards: ${counts.cards}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
