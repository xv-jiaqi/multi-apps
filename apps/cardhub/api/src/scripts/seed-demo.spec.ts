import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { seedDemo } from './seed-demo';
import { CATALOG_SERIES, DEMO_USERS } from './seed-data';

function makePrisma() {
  const seriesUpsert = jest.fn(({ where }) => Promise.resolve({ id: `series-${where.slug}` }));
  const cardUpsert = jest.fn(() => Promise.resolve({}));
  const seriesCount = jest.fn(() => Promise.resolve(CATALOG_SERIES.length));
  const cardCount = jest.fn(() =>
    Promise.resolve(CATALOG_SERIES.reduce((total, series) => total + series.cards.length, 0)),
  );
  const userUpsert = jest.fn(() => Promise.resolve({}));
  const userCount = jest.fn(() => Promise.resolve(DEMO_USERS.length));

  const prisma = {
    series: { upsert: seriesUpsert, count: seriesCount },
    card: { upsert: cardUpsert, count: cardCount },
    user: { upsert: userUpsert, count: userCount },
  } as unknown as PrismaClient;

  return { prisma, seriesUpsert, userUpsert };
}

describe('seedDemo', () => {
  it('fails before writing catalog rows when demo passwords are missing', async () => {
    const { prisma, seriesUpsert, userUpsert } = makePrisma();

    await expect(seedDemo(prisma, {})).rejects.toThrow('Missing required DEMO_USER_PASSWORD');

    expect(seriesUpsert).not.toHaveBeenCalled();
    expect(userUpsert).not.toHaveBeenCalled();
  });

  it('reads demo passwords from env and stores only hashes', async () => {
    const { prisma, userUpsert } = makePrisma();

    await seedDemo(prisma, {
      DEMO_USER_PASSWORD: 'local-user-password',
      DEMO_ADMIN_PASSWORD: 'local-admin-password',
    });

    expect(userUpsert).toHaveBeenCalledTimes(DEMO_USERS.length);

    const aliceCall = userUpsert.mock.calls.find(([arg]) => arg.where.username === 'alice')?.[0];
    const adminCall = userUpsert.mock.calls.find(([arg]) => arg.where.username === 'admin')?.[0];

    if (!aliceCall || !adminCall) {
      throw new Error('Expected demo seed to upsert both alice and admin');
    }
    expect(aliceCall.create.password).not.toBe('local-user-password');
    expect(adminCall.create.password).not.toBe('local-admin-password');
    await expect(bcrypt.compare('local-user-password', aliceCall.create.password)).resolves.toBe(
      true,
    );
    await expect(bcrypt.compare('local-admin-password', adminCall.create.password)).resolves.toBe(
      true,
    );
    expect(aliceCall.update.password).toBe(aliceCall.create.password);
    expect(adminCall.update.password).toBe(adminCall.create.password);
  });
});
