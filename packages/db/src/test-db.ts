/**
 * Test helper: a freshly migrated database per test file. Uses TEST_DATABASE_URL when set (CI service
 * container, must be a superuser), otherwise starts a throwaway Postgres via Testcontainers.
 *
 * `asRole()` returns a pool that connects as one of the real least-privilege roles, so tests can prove
 * what a service can and cannot do. Superuser pools hide grant bugs; use roles for anything security-related.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type pg from 'pg';
import { createDb, createPool, type Db } from './client.js';
import { applyGrants, migrateUp } from './migrate.js';

export type PinkasRole = 'pinkas_api' | 'pinkas_worker' | 'pinkas_readonly' | 'pinkas_backup';
const ROLES: PinkasRole[] = ['pinkas_api', 'pinkas_worker', 'pinkas_readonly', 'pinkas_backup'];
const ROLE_PASSWORD = 'test-role-password';

export interface TestDb {
  /** Superuser handles: for fixtures and assertions only. */
  db: Db;
  pool: pg.Pool;
  /** A pool connected as the given role, with grants.sql applied. Closed by stop(). */
  asRole(role: PinkasRole): Promise<pg.Pool>;
  stop(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl = process.env['TEST_DATABASE_URL'];
  if (!adminUrl) {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    adminUrl = container.getConnectionUri();
  }
  const dbName = `t_${Math.random().toString(36).slice(2, 10)}`;
  const admin = createPool(adminUrl, undefined);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const pool = createPool(url.toString(), undefined);
  await migrateUp(pool);
  const rolePools: pg.Pool[] = [];
  let rolesReady = false;

  return {
    db: createDb(pool),
    pool,
    async asRole(role) {
      if (!rolesReady) {
        // Roles are cluster-global, but advisory locks are per database: take the lock on the admin database,
        // which every test file shares, so parallel files on one cluster (CI) never race on CREATE/ALTER ROLE.
        const lock = await admin.connect();
        try {
          await lock.query('SELECT pg_advisory_lock(7183)');
          for (const r of ROLES) {
            const exists = await lock.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r]);
            if (exists.rowCount === 0)
              await lock.query(`CREATE ROLE ${r} LOGIN PASSWORD '${ROLE_PASSWORD}'`);
          }
          await lock.query('ALTER ROLE pinkas_readonly SET default_transaction_read_only = on');
        } finally {
          await lock.query('SELECT pg_advisory_unlock(7183)');
          lock.release();
        }
        // Grants live in this database's catalogs, so they need no cross-file lock.
        const client = await pool.connect();
        try {
          await applyGrants(client);
        } finally {
          client.release();
        }
        rolesReady = true;
      }
      const roleUrl = new URL(url.toString());
      roleUrl.username = role;
      roleUrl.password = ROLE_PASSWORD;
      const rolePool = createPool(roleUrl.toString(), undefined);
      rolePools.push(rolePool);
      return rolePool;
    },
    async stop() {
      await Promise.all([...rolePools, pool].map(closePool));
      // No FORCE: a connection still open here is a leak, and the DROP should fail loudly.
      await admin.query(`DROP DATABASE ${dbName}`);
      await closePool(admin);
      await container?.stop();
    },
  };
}

/**
 * pg-pool's end() resolves as soon as its client list is empty, before the clients' sockets close. Dropping the
 * database or stopping the container in that window terminates the backends, and the half-closed clients
 * raise unhandled 57P01 errors. Wait for each client's own 'remove', emitted after its socket ends.
 */
async function closePool(pool: pg.Pool): Promise<void> {
  let left = pool.totalCount;
  const closed = new Promise<void>((resolve) => {
    if (left === 0) resolve();
    pool.on('remove', () => {
      if (--left === 0) resolve();
    });
  });
  await pool.end();
  await closed;
}
