-- Re-applied after every migration so new objects never leak to the wrong role. Idempotent.
GRANT USAGE ON SCHEMA public TO pinkas_api, pinkas_worker, pinkas_readonly, pinkas_backup;

-- api: everything except reading credential ciphertext.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pinkas_api;
REVOKE SELECT ON credentials FROM pinkas_api;
GRANT SELECT (source_id, key_fingerprint, updated_at) ON credentials TO pinkas_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pinkas_api;

-- worker: read what it needs, write only the ledger-side tables.
GRANT SELECT ON sources, credentials, accounts, transactions, transaction_links, categories, category_rules, settings TO pinkas_worker;
GRANT INSERT, UPDATE ON accounts, transactions, transaction_links, card_settlements, sync_runs, balance_snapshots TO pinkas_worker;
GRANT DELETE ON sync_runs TO pinkas_worker;
GRANT DELETE ON transaction_links, card_settlements TO pinkas_worker;
GRANT UPDATE (hash_kind, hash_kind_downgraded_at, enabled, last_success_at, last_error_type, last_error_at) ON sources TO pinkas_worker;
GRANT UPDATE (hit_count) ON category_rules TO pinkas_worker;

-- readonly (MCP): reporting surface only.
GRANT SELECT ON v_cashflow_transactions, v_category_month, v_monthly_cashflow, categories, budgets, expected_income, recurring_series, insights TO pinkas_readonly;
GRANT SELECT (id, source_id, masked_label, type, currency, display_name, is_active, balance_agorot, balance_at) ON accounts TO pinkas_readonly;
GRANT SELECT (id, kind, company_id, display_name, enabled, last_success_at, last_error_type, last_error_at) ON sources TO pinkas_readonly;

-- backup: full read for pg_dump.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pinkas_backup;
