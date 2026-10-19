/**
 * Minimal migration runner: applies migrations/NNNN_name.sql in order, records them in schema_migrations,
 * and re-applies grants.sql after each run. `down` reverts the last applied migration using its .down.sql.
 * drizzle-kit only *generates* SQL; it never touches the database.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
// Works from src (tsx) and dist (node).
const migrationsDir = join(here, '..', 'migrations');
const grantsFile = join(here, '..', 'grants.sql');

const BREAKPOINT = '--> statement-breakpoint';

function listMigrations(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();
}

async function ensureTable(client: pg.PoolClient): Promise<void> {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
}

async function runSqlFile(client: pg.PoolClient, file: string): Promise<void> {
  const sql = readFileSync(file, 'utf8');
  for (const stmt of sql.split(BREAKPOINT)) {
    if (stmt.trim()) await client.query(stmt);
  }
}

export async function applyGrants(
  client: pg.PoolClient,
  opts: { skipIfRolesMissing?: boolean } = {},
): Promise<void> {
  const roles = await client.query<{ rolname: string }>(
    "SELECT rolname FROM pg_roles WHERE rolname LIKE 'pinkas_%'",
  );
  if (roles.rows.length === 0 && opts.skipIfRolesMissing) return; // test databases without roles
  await runSqlFile(client, grantsFile);
}

export async function migrateUp(
  pool: pg.Pool,
  log: (msg: string) => void = () => undefined,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(7182)');
    await ensureTable(client);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    for (const file of listMigrations()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await runSqlFile(client, join(migrationsDir, file));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    await applyGrants(client, { skipIfRolesMissing: true });
  } finally {
    await client.query('SELECT pg_advisory_unlock(7182)');
    client.release();
  }
  return applied;
}

export async function migrateDown(
  pool: pg.Pool,
  log: (msg: string) => void = () => undefined,
): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const last = (
      await client.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
      )
    ).rows[0];
    if (!last) return undefined;
    const downFile = join(migrationsDir, last.name.replace(/\.sql$/, '.down.sql'));
    await client.query('BEGIN');
    try {
      await runSqlFile(client, downFile);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [last.name]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    log(`reverted ${last.name}`);
    return last.name;
  } finally {
    client.release();
  }
}

// CLI: node migrate.js up|down
if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  const { createPool } = await import('./client.js');
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  const cmd = process.argv[2] ?? 'up';
  const log = (m: string) => process.stdout.write(`${m}\n`);
  try {
    if (cmd === 'up') {
      const applied = await migrateUp(pool, log);
      log(applied.length ? `done (${applied.length} applied)` : 'up to date');
    } else if (cmd === 'down') {
      const name = await migrateDown(pool, log);
      log(name ? 'done' : 'nothing to revert');
    } else {
      throw new Error(`unknown command ${cmd}`);
    }
  } finally {
    await pool.end();
  }
}
