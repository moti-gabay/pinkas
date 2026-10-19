/**
 * Permission matrix, proven by connecting as the real roles. Both directions: what each service needs
 * works, and everything else is denied by Postgres (42501), not by application code.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTaxonomy } from './seed-taxonomy.js';
import { startTestDb, type TestDb } from './test-db.js';

const DENIED = /permission denied|read-only transaction/;

/**
 * Runs a statement inside a transaction that is always rolled back, so allowed writes leave no trace.
 * Returns 'ok', or the error message.
 */
async function attempt(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql, params);
    return 'ok';
  } catch (err) {
    return (err as Error).message;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('database roles', () => {
  let t: TestDb;
  let api: pg.Pool;
  let worker: pg.Pool;
  let readonly: pg.Pool;
  let sourceId: string;
  let accountId: string;
  let txnId: string;
  let categoryId: string;

  beforeAll(async () => {
    t = await startTestDb();
    await seedTaxonomy(t.db);
    sourceId = (
      await t.pool.query<{ id: string }>(
        "INSERT INTO sources (kind, company_id, display_name) VALUES ('scraper','max','max') RETURNING id",
      )
    ).rows[0]!.id;
    await t.pool.query(
      "INSERT INTO credentials (source_id, ciphertext, key_fingerprint) VALUES ($1, '\\xdeadbeef', 'fp')",
      [sourceId],
    );
    accountId = (
      await t.pool.query<{ id: string }>(
        "INSERT INTO accounts (source_id, external_id, masked_label, type, display_name) VALUES ($1,'4580123412341234','****1234','credit_card','max') RETURNING id",
        [sourceId],
      )
    ).rows[0]!.id;
    categoryId = (
      await t.pool.query<{ id: string }>("SELECT id FROM categories WHERE slug = 'food'")
    ).rows[0]!.id;
    txnId = (
      await t.pool.query<{ id: string }>(
        "INSERT INTO transactions (account_id, dedupe_hash, hash_kind, origin, txn_date, charged_amount_agorot, status, description_raw, merchant_normalized, category_id, raw) VALUES ($1,'h1','fields','scraper','2026-03-01',-1000,'completed','x','x',$2,'{\"secret\":1}') RETURNING id",
        [accountId, categoryId],
      )
    ).rows[0]!.id;
    await t.pool.query(
      "INSERT INTO imports (file_name, file_sha256, size_bytes, mime) VALUES ('f','sha',1,'csv')",
    );
    await t.pool.query(
      "INSERT INTO settings (key, value) VALUES ('auth_password_hash', '\"hash\"')",
    );
    api = await t.asRole('pinkas_api');
    worker = await t.asRole('pinkas_worker');
    readonly = await t.asRole('pinkas_readonly');
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  describe('pinkas_api', () => {
    it('cannot read credential ciphertext, by column or by *', async () => {
      expect(await attempt(api, 'SELECT ciphertext FROM credentials')).toMatch(DENIED);
      expect(await attempt(api, 'SELECT * FROM credentials')).toMatch(DENIED);
      expect(await attempt(api, 'SELECT encode(ciphertext, $1) FROM credentials', ['hex'])).toMatch(
        DENIED,
      );
      expect(
        await attempt(
          api,
          'UPDATE credentials SET key_fingerprint = key_fingerprint RETURNING ciphertext',
        ),
      ).toMatch(DENIED);
      expect(await attempt(api, 'COPY credentials TO STDOUT')).toMatch(DENIED);
    });
    it('can store, replace and delete credentials and read their metadata', async () => {
      expect(
        await attempt(api, 'SELECT source_id, key_fingerprint, updated_at FROM credentials'),
      ).toBe('ok');
      // Mirrors the API's upsert: new values are bound parameters. (Reading `excluded.ciphertext` would itself
      // require SELECT on the column, which the role must not have.)
      expect(
        await attempt(
          api,
          "INSERT INTO credentials (source_id, ciphertext, key_fingerprint) VALUES ($1, $2, 'fp2') ON CONFLICT (source_id) DO UPDATE SET ciphertext = $2, key_fingerprint = 'fp2', updated_at = now()",
          [sourceId, Buffer.from([1, 2, 3])],
        ),
      ).toBe('ok');
      expect(await attempt(api, 'DELETE FROM credentials WHERE source_id = $1', [sourceId])).toBe(
        'ok',
      );
    });
    it('can work with every app table it serves', async () => {
      for (const table of [
        'sources',
        'accounts',
        'categories',
        'category_rules',
        'imports',
        'import_rows',
        'transactions',
        'transaction_links',
        'card_settlements',
        'budgets',
        'expected_income',
        'recurring_series',
        'sync_runs',
        'insights',
        'llm_calls',
        'settings',
        'sessions',
        'v_monthly_cashflow',
      ]) {
        expect(await attempt(api, `SELECT * FROM ${table} LIMIT 1`), table).toBe('ok');
      }
      expect(
        await attempt(api, 'UPDATE transactions SET notes = $1 WHERE id = $2', ['n', txnId]),
      ).toBe('ok');
      expect(
        await attempt(
          api,
          "INSERT INTO sync_runs (source_id, trigger, status) VALUES ($1,'manual','queued')",
          [sourceId],
        ),
      ).toBe('ok');
      expect(await attempt(api, 'DELETE FROM sources WHERE id = $1', [sourceId])).toBe('ok');
    });
    it('cannot touch migration bookkeeping or change the schema', async () => {
      expect(await attempt(api, 'DELETE FROM schema_migrations')).toMatch(DENIED);
      expect(await attempt(api, 'DROP TABLE transactions')).toMatch(/must be owner/);
      expect(await attempt(api, 'ALTER TABLE credentials DISABLE TRIGGER ALL')).toMatch(
        /must be owner/,
      );
    });
  });

  describe('pinkas_readonly', () => {
    it('reads the reporting surface', async () => {
      for (const rel of [
        'v_cashflow_transactions',
        'v_category_month',
        'v_monthly_cashflow',
        'categories',
        'budgets',
        'expected_income',
        'recurring_series',
        'insights',
      ]) {
        expect(await attempt(readonly, `SELECT * FROM ${rel} LIMIT 1`), rel).toBe('ok');
      }
      expect(
        await attempt(
          readonly,
          'SELECT id, masked_label, display_name, balance_agorot FROM accounts',
        ),
      ).toBe('ok');
      expect(await attempt(readonly, 'SELECT id, display_name, last_success_at FROM sources')).toBe(
        'ok',
      );
    });
    it('cannot read credentials, imports, raw payloads, the base ledger, sessions or full account numbers', async () => {
      for (const sql of [
        'SELECT * FROM credentials',
        'SELECT source_id FROM credentials',
        'SELECT * FROM imports',
        'SELECT * FROM import_rows',
        'SELECT raw FROM transactions',
        'SELECT * FROM transactions',
        'SELECT id FROM transactions',
        'SELECT * FROM settings',
        'SELECT * FROM sessions',
        'SELECT * FROM llm_calls',
        'SELECT * FROM sync_runs',
        'SELECT external_id FROM accounts',
        'SELECT * FROM accounts',
        'SELECT * FROM sources',
        'SELECT * FROM category_rules',
        'SELECT * FROM transaction_links',
        'SELECT * FROM schema_migrations',
      ]) {
        expect(await attempt(readonly, sql), sql).toMatch(DENIED);
      }
    });
    it('cannot write anything, anywhere', async () => {
      const tables = (
        await t.pool.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
        )
      ).rows.map((r) => r.tablename);
      expect(tables.length).toBeGreaterThan(18);
      for (const table of tables) {
        expect(
          await attempt(readonly, `INSERT INTO ${table} DEFAULT VALUES`),
          `insert ${table}`,
        ).toMatch(DENIED);
        expect(
          await attempt(readonly, `UPDATE ${table} SET ctid = ctid`),
          `update ${table}`,
        ).not.toBe('ok');
        expect(await attempt(readonly, `DELETE FROM ${table}`), `delete ${table}`).toMatch(DENIED);
        expect(await attempt(readonly, `TRUNCATE ${table} CASCADE`), `truncate ${table}`).toMatch(
          DENIED,
        );
      }
      expect(await attempt(readonly, 'UPDATE budgets SET amount_agorot = 0')).toMatch(DENIED);
      expect(
        await attempt(readonly, 'UPDATE v_cashflow_transactions SET merchant_normalized = $1', [
          'x',
        ]),
      ).not.toBe('ok');
      expect(await attempt(readonly, 'CREATE TABLE evil (id int)')).toMatch(DENIED);
      // Even if a grant were added by mistake, the role's sessions are read-only by default.
      const ro = await readonly.query<{ v: string }>(
        "SELECT current_setting('default_transaction_read_only') AS v",
      );
      expect(ro.rows[0]?.v).toBe('on');
    });
  });

  describe('pinkas_worker', () => {
    it('has exactly the privileges listed in grants.sql and nothing else', async () => {
      const { rows } = await t.pool.query<{ rel: string; priv: string; col: string | null }>(`
        SELECT table_name AS rel, privilege_type AS priv, NULL AS col FROM information_schema.role_table_grants WHERE grantee = 'pinkas_worker'
        UNION ALL
        SELECT table_name, privilege_type, column_name FROM information_schema.role_column_grants c WHERE grantee = 'pinkas_worker'
          AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants t WHERE t.grantee = c.grantee AND t.table_name = c.table_name AND t.privilege_type = c.privilege_type)`);
      const actual = [
        ...new Set(rows.map((r) => `${r.rel}:${r.priv}${r.col ? `(${r.col})` : ''}`)),
      ].sort();
      expect(actual).toEqual(
        [
          'accounts:INSERT',
          'accounts:SELECT',
          'accounts:UPDATE(balance_agorot)',
          'accounts:UPDATE(balance_at)',
          'balance_snapshots:INSERT',
          'balance_snapshots:SELECT(account_id)',
          'balance_snapshots:SELECT(as_of)',
          'card_settlements:DELETE',
          'card_settlements:INSERT',
          'categories:SELECT',
          'category_rules:SELECT',
          'category_rules:UPDATE(hit_count)',
          'credentials:SELECT',
          'sources:SELECT',
          'sources:UPDATE(enabled)',
          'sources:UPDATE(hash_kind)',
          'sources:UPDATE(last_error_at)',
          'sources:UPDATE(last_error_type)',
          'sources:UPDATE(last_success_at)',
          'sync_runs:INSERT',
          'sync_runs:SELECT',
          'sync_runs:UPDATE',
          'transaction_links:DELETE',
          'transaction_links:INSERT',
          'transaction_links:SELECT',
          'transactions:INSERT',
          'transactions:SELECT',
          'transactions:UPDATE',
        ].sort(),
      );
    });
    it('is denied everything outside its job', async () => {
      for (const sql of [
        'SELECT * FROM settings',
        'SELECT * FROM sessions',
        'SELECT * FROM imports',
        'SELECT * FROM import_rows',
        'SELECT * FROM budgets',
        'SELECT * FROM expected_income',
        'SELECT * FROM insights',
        'SELECT * FROM llm_calls',
        'SELECT * FROM recurring_series',
        'SELECT * FROM balance_snapshots',
        'SELECT * FROM card_settlements',
        'SELECT * FROM schema_migrations',
        'DELETE FROM transactions',
        'DELETE FROM accounts',
        'DELETE FROM sources',
        'DELETE FROM sync_runs',
        'DELETE FROM credentials',
        'DELETE FROM categories',
        "UPDATE credentials SET key_fingerprint = 'x'",
        "INSERT INTO credentials (source_id, ciphertext, key_fingerprint) VALUES (gen_random_uuid(), '\\x00', 'x')",
        "UPDATE sources SET display_name = 'x'",
        "UPDATE sources SET company_id = 'leumi'",
        "UPDATE sources SET schedule_cron = '* * * * *'",
        "INSERT INTO sources (kind, display_name) VALUES ('file','x')",
        "UPDATE accounts SET external_id = 'x'",
        "UPDATE accounts SET display_name = 'x'",
        "UPDATE category_rules SET pattern = 'x'",
        "UPDATE categories SET name_he = 'x'",
        'UPDATE transaction_links SET confidence = 1',
        'UPDATE card_settlements SET diff_agorot = 0',
        'TRUNCATE transactions',
        'DROP TABLE transactions',
      ]) {
        expect(await attempt(worker, sql), sql).not.toBe('ok');
      }
    });
  });
});
