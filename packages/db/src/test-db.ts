/**
 * Test helper: a freshly migrated database per test file. Uses TEST_DATABASE_URL when set (CI service
 * container, must allow CREATE DATABASE), otherwise starts a throwaway Postgres via Testcontainers.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type pg from 'pg';
import { createDb, createPool, type Db } from './client.js';
import { migrateUp } from './migrate.js';

export interface TestDb {
  db: Db;
  pool: pg.Pool;
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
  return {
    db: createDb(pool),
    pool,
    async stop() {
      await pool.end();
      await admin.query(`DROP DATABASE ${dbName}`);
      await admin.end();
      await container?.stop();
    },
  };
}
