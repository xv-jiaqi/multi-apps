import { Client } from 'pg';
import { databaseTarget, quoteIdent } from './harness.ts';

/** Create the smoke database if needed. Safe to run before the API process starts. */
export async function ensureDatabase(): Promise<void> {
  const target = databaseTarget();
  const maintenance = ['postgres', 'template1'].filter((name) => name !== target.database);
  let lastError: unknown;
  for (const database of maintenance) {
    const client = new Client({ ...target, database });
    try {
      await client.connect();
      try {
        const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
          target.database,
        ]);
        if ((existing.rowCount ?? 0) === 0) {
          await client.query(`CREATE DATABASE ${quoteIdent(target.database)}`);
          console.info(`Created database ${target.database}.`);
        }
        return;
      } finally {
        await client.end();
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not ensure database ${target.database}`, { cause: lastError });
}

if (process.argv[1]?.endsWith('ensure-db.ts')) {
  await ensureDatabase();
}
