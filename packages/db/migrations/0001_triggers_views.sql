-- sources.hash_kind is sticky and downgrade-only (ADR 0007).
CREATE OR REPLACE FUNCTION sources_hash_kind_no_upgrade() RETURNS trigger AS $$
BEGIN
  IF OLD.hash_kind = 'fields' AND NEW.hash_kind = 'identifier' THEN
    RAISE EXCEPTION 'sources.hash_kind cannot be upgraded back to identifier (source %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.hash_kind = 'identifier' AND NEW.hash_kind = 'fields' AND NEW.hash_kind_downgraded_at IS NULL THEN
    NEW.hash_kind_downgraded_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sources_hash_kind_no_upgrade BEFORE UPDATE OF hash_kind ON sources
  FOR EACH ROW EXECUTE FUNCTION sources_hash_kind_no_upgrade();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Reporting views: what the read-only role (MCP) sees. No raw payloads, no full account numbers.
CREATE VIEW v_cashflow_transactions AS
SELECT t.id, t.account_id, a.masked_label AS account_label, a.type AS account_type, t.txn_date, t.processed_date,
       t.charged_amount_agorot, t.original_amount_minor, t.original_currency, t.status, t.merchant_normalized,
       t.installment_number, t.installment_total, t.category_id, c.slug AS category_slug,
       CASE WHEN c.slug = 'uncategorized' THEN NULL ELSE c.kind END AS category_kind,
       COALESCE(t.is_fixed, c.is_fixed_default, false) AS is_fixed, t.tags
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.exclude_reason IS NULL AND (c.kind IS NULL OR c.kind <> 'transfer');
--> statement-breakpoint
CREATE VIEW v_category_month AS
SELECT to_char(txn_date, 'YYYY-MM') AS month, category_id, category_slug, category_kind, is_fixed, account_type,
       SUM(charged_amount_agorot)::bigint AS amount_agorot, COUNT(*)::int AS txn_count
FROM v_cashflow_transactions
GROUP BY 1, 2, 3, 4, 5, 6;
--> statement-breakpoint
CREATE VIEW v_monthly_cashflow AS
SELECT month,
       SUM(CASE WHEN category_kind = 'income' OR (category_kind IS NULL AND amount_agorot > 0 AND account_type <> 'credit_card') THEN amount_agorot ELSE 0 END)::bigint AS income_agorot,
       (-SUM(CASE WHEN category_kind = 'income' OR (category_kind IS NULL AND amount_agorot > 0 AND account_type <> 'credit_card') THEN 0 ELSE amount_agorot END))::bigint AS expenses_agorot,
       SUM(amount_agorot)::bigint AS net_agorot
FROM v_category_month
GROUP BY month;
