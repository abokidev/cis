import path from 'path';
import { Pool } from 'pg';

import runner from 'node-pg-migrate';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://cis:cis_test_password@localhost:5433/cis_test';

let pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  }
  return pool;
}

export async function runMigrations(): Promise<void> {
  await (runner as unknown as typeof runner)({
    databaseUrl: DATABASE_URL,
    dir: path.join(__dirname, '../migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',

    log: () => {},
  });
}

export async function truncateAllTables(pool: Pool): Promise<void> {
  // Order respects FK dependencies. audit_log TRUNCATE is allowed (trigger only blocks UPDATE/DELETE).
  await pool.query(`
    TRUNCATE TABLE
      edition_instrument_snapshots,
      edition_participation,
      critical_actions,
      user_roles,
      role_permissions,
      audit_log,
      instrument_definition_versions,
      instrument_definitions,
      editions,
      organizations,
      permissions,
      roles,
      users
    RESTART IDENTITY CASCADE
  `);
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
