import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

import { verifyPassword } from '../modules/auth/password-hash';
import { seedDemo } from './seed-demo';
import { CATALOG_SERIES, DEMO_USERS } from './seed-data';

interface UserUpsertArgs {
  where: { username: string };
  update: { password: string };
  create: { password: string };
}

function makePrisma() {
  const categoryUpsert = jest.fn(() => Promise.resolve({ id: 'category-deck-builder' }));
  const seriesUpsert = jest.fn(({ where }) => Promise.resolve({ id: `series-${where.slug}` }));
  const subsetUpsert = jest.fn(() => Promise.resolve({}));
  const cardUpsert = jest.fn(() => Promise.resolve({}));
  const seriesCount = jest.fn(() => Promise.resolve(CATALOG_SERIES.length));
  const cardCount = jest.fn(() =>
    Promise.resolve(CATALOG_SERIES.reduce((total, series) => total + series.cards.length, 0)),
  );
  const userUpsert = jest.fn((_: UserUpsertArgs) => Promise.resolve({}));
  const userCount = jest.fn(() => Promise.resolve(DEMO_USERS.length));

  const prisma = {
    category: { upsert: categoryUpsert },
    series: { upsert: seriesUpsert, count: seriesCount },
    subset: { upsert: subsetUpsert },
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
    const userPassword = randomUUID();
    const adminPassword = randomUUID();

    await seedDemo(prisma, {
      DEMO_USER_PASSWORD: userPassword,
      DEMO_ADMIN_PASSWORD: adminPassword,
    });

    expect(userUpsert).toHaveBeenCalledTimes(DEMO_USERS.length);

    const upsertArgs = userUpsert.mock.calls.map(([arg]) => arg);
    const aliceCall = upsertArgs.find((arg) => arg.where.username === 'alice');
    const adminCall = upsertArgs.find((arg) => arg.where.username === 'admin');

    if (!aliceCall || !adminCall) {
      throw new Error('Expected demo seed to upsert both alice and admin');
    }
    expect(aliceCall.create.password).not.toBe(userPassword);
    expect(adminCall.create.password).not.toBe(adminPassword);
    expect(aliceCall.create.password.startsWith('$2')).toBe(true);
    expect(adminCall.create.password.startsWith('$2')).toBe(true);
    await expect(bcrypt.compare(userPassword, aliceCall.create.password)).resolves.toBe(true);
    await expect(verifyPassword(userPassword, aliceCall.create.password)).resolves.toMatchObject({
      ok: true,
      upgradedHash: null,
    });
    expect(aliceCall.update.password).toBe(aliceCall.create.password);
    expect(adminCall.update.password).toBe(adminCall.create.password);
  });

  it('stores the pre-hashed format when PASSWORD_PREHASH_WRITE is true', async () => {
    const { prisma, userUpsert } = makePrisma();
    const userPassword = randomUUID();
    const adminPassword = randomUUID();

    await seedDemo(prisma, {
      DEMO_USER_PASSWORD: userPassword,
      DEMO_ADMIN_PASSWORD: adminPassword,
      PASSWORD_PREHASH_WRITE: 'true',
    });

    const upsertArgs = userUpsert.mock.calls.map(([arg]) => arg);
    const aliceCall = upsertArgs.find((arg) => arg.where.username === 'alice');
    const adminCall = upsertArgs.find((arg) => arg.where.username === 'admin');
    if (!aliceCall || !adminCall) {
      throw new Error('Expected demo seed to upsert both alice and admin');
    }

    expect(aliceCall.create.password.startsWith('sha256$')).toBe(true);
    expect(adminCall.create.password.startsWith('sha256$')).toBe(true);
    await expect(verifyPassword(userPassword, aliceCall.create.password)).resolves.toMatchObject({
      ok: true,
      upgradedHash: null,
    });
    await expect(verifyPassword(adminPassword, adminCall.create.password)).resolves.toMatchObject({
      ok: true,
      upgradedHash: null,
    });
    await expect(bcrypt.compare(userPassword, aliceCall.create.password)).resolves.toBe(false);
  });
});
