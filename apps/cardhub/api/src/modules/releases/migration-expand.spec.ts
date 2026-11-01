import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationDir = join(__dirname, '../../../prisma/migrations');

describe('add_release_calendar migration', () => {
  const matches = readdirSync(migrationDir).filter((name) =>
    name.endsWith('_add_release_calendar'),
  );
  const sql = readFileSync(join(migrationDir, matches[0] ?? '', 'migration.sql'), 'utf8');

  it('only adds the releases table, its enums, and the list indexes', () => {
    expect(matches).toEqual(['20261101143000_add_release_calendar']);
    expect(sql).toContain('CREATE TABLE "releases"');
    expect(sql).toContain('CREATE TYPE "ReleaseRegion"');
    expect(sql).toContain('CREATE TYPE "ReleaseDatePrecision"');
    expect(sql).toContain('"datePrecision" "ReleaseDatePrecision" NOT NULL DEFAULT \'DAY\'');
    expect(sql).toContain('CREATE INDEX "releases_releaseDate_id_idx"');
    expect(sql).toContain('CREATE INDEX "releases_categoryId_releaseDate_id_idx"');
    expect(sql).toContain(
      'FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE',
    );
    expect(sql.toLowerCase()).not.toContain('drop ');
    expect(sql).not.toMatch(
      /ALTER TABLE "(users|series|cards|categories|subsets|comments|topics|replies|listings|reports|audit_logs|collection_items|user_daily_activities)"/,
    );
  });
});
