-- Least-privilege grants. DECLARATIVE: everything is revoked first, then exactly what each service needs is
-- granted, so removing a line here really removes the privilege on the next migrate. Re-applied after every
-- migration. Verified by packages/db/src/roles.test.ts and the role-based tests in apps/api and apps/sync-worker.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pinkas_api, pinkas_worker, pinkas_readonly, pinkas_backup;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM pinkas_api, pinkas_worker, pinkas_readonly, pinkas_backup;
GRANT USAGE ON SCHEMA public TO pinkas_api, pinkas_worker, pinkas_readonly, pinkas_backup;

-- ── api: owns the app tables, but can never read credential ciphertext (it only seals with the public key).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  sources, accounts, balance_snapshots, categories, category_rules, imports, import_rows, transactions,
  transaction_links, card_settlements, budgets, expected_income, recurring_series, sync_runs, insights,
  llm_calls, settings, sessions
  TO pinkas_api;
GRANT SELECT ON v_cashflow_transactions, v_category_month, v_monthly_cashflow TO pinkas_api;
GRANT INSERT, DELETE ON credentials TO pinkas_api;
GRANT SELECT (source_id, key_fingerprint, updated_at) ON credentials TO pinkas_api;
GRANT UPDATE (ciphertext, key_fingerprint, updated_at) ON credentials TO pinkas_api;

-- ── sync-worker: each line is tied to a statement in apps/sync-worker or packages/db/{ingest,relink}.ts.
GRANT SELECT ON sources TO pinkas_worker;                         -- load the source to sync, list scheduled sources
GRANT UPDATE (enabled, hash_kind, last_success_at, last_error_type, last_error_at) ON sources TO pinkas_worker;
                                                                  -- disable on login failure, sticky downgrade, run outcome
GRANT SELECT ON credentials TO pinkas_worker;                     -- the sealed box it alone can open
GRANT SELECT, INSERT ON accounts TO pinkas_worker;                -- find/create scraped accounts
GRANT UPDATE (balance_agorot, balance_at) ON accounts TO pinkas_worker;
GRANT INSERT ON balance_snapshots TO pinkas_worker;
GRANT SELECT (account_id, as_of) ON balance_snapshots TO pinkas_worker; -- arbiter columns of ON CONFLICT DO NOTHING
GRANT SELECT, INSERT, UPDATE ON transactions TO pinkas_worker;    -- dedupe lookup, insert, pending→completed, exclusion flags
GRANT SELECT, INSERT, DELETE ON transaction_links TO pinkas_worker; -- relink: rebuild system transfer links, add refund links
GRANT INSERT, DELETE ON card_settlements TO pinkas_worker;        -- relink: settlements are rebuilt from scratch
GRANT SELECT, INSERT, UPDATE ON sync_runs TO pinkas_worker;       -- claim queued runs, record outcomes
GRANT SELECT ON categories TO pinkas_worker;                      -- the 'uncategorized' default
GRANT SELECT ON category_rules TO pinkas_worker;                  -- rules-based categorization on insert
GRANT UPDATE (hit_count) ON category_rules TO pinkas_worker;

-- ── readonly (MCP): reporting surface only. No base ledger table, no raw payloads, no full account numbers.
GRANT SELECT ON v_cashflow_transactions, v_category_month, v_monthly_cashflow, categories, budgets,
  expected_income, recurring_series, insights TO pinkas_readonly;
GRANT SELECT (id, source_id, masked_label, type, currency, display_name, is_active, balance_agorot, balance_at)
  ON accounts TO pinkas_readonly;
GRANT SELECT (id, kind, company_id, display_name, enabled, last_success_at, last_error_type, last_error_at)
  ON sources TO pinkas_readonly;

-- ── backup: full read for pg_dump (the dump is encrypted before it touches disk).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pinkas_backup;
