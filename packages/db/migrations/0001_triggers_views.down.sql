DROP VIEW IF EXISTS v_monthly_cashflow;
DROP VIEW IF EXISTS v_category_month;
DROP VIEW IF EXISTS v_cashflow_transactions;
DROP TRIGGER IF EXISTS transactions_set_updated_at ON transactions;
DROP FUNCTION IF EXISTS set_updated_at();
DROP TRIGGER IF EXISTS sources_hash_kind_no_upgrade ON sources;
DROP FUNCTION IF EXISTS sources_hash_kind_no_upgrade();
