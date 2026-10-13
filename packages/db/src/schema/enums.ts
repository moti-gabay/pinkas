import { pgEnum } from 'drizzle-orm/pg-core';

export const sourceKind = pgEnum('source_kind', ['scraper', 'file']);
export const hashKind = pgEnum('hash_kind', ['identifier', 'fields']);
export const accountType = pgEnum('account_type', ['checking', 'credit_card', 'savings']);
export const txnOrigin = pgEnum('txn_origin', ['scraper', 'import', 'manual']);
export const txnStatus = pgEnum('txn_status', ['pending', 'completed']);
export const categorySource = pgEnum('category_source', [
  'rule',
  'ai',
  'manual',
  'refund_link',
  'default',
]);
export const excludeReason = pgEnum('exclude_reason', [
  'card_settlement',
  'internal_transfer',
  'duplicate',
  'user',
]);
export const linkKind = pgEnum('link_kind', [
  'card_settlement',
  'transfer',
  'refund',
  'pending_update',
]);
export const createdBy = pgEnum('created_by', ['system', 'user']);
export const settlementStatus = pgEnum('settlement_status', ['matched', 'partial', 'unmatched']);
export const categoryKind = pgEnum('category_kind', ['expense', 'income', 'transfer']);
export const ruleMatch = pgEnum('rule_match', ['contains', 'exact', 'regex', 'prefix']);
export const ruleField = pgEnum('rule_field', ['merchant_normalized', 'description_raw']);
export const ruleOrigin = pgEnum('rule_origin', ['seed', 'user', 'learned']);
export const cadence = pgEnum('cadence', ['weekly', 'monthly', 'bimonthly', 'quarterly', 'yearly']);
export const recurringStatus = pgEnum('recurring_status', ['active', 'paused', 'ended', 'ignored']);
export const syncTrigger = pgEnum('sync_trigger', ['schedule', 'manual']);
export const syncStatus = pgEnum('sync_status', ['running', 'success', 'failed', 'partial']);
export const importStatus = pgEnum('import_status', [
  'uploaded',
  'parsed',
  'awaiting_confirm',
  'committed',
  'failed',
  'cancelled',
]);
export const llmMode = pgEnum('llm_mode', ['none', 'redacted_text', 'raw_pdf']);
export const importDecision = pgEnum('import_decision', [
  'insert',
  'duplicate',
  'update_pending',
  'error',
]);
export const insightKind = pgEnum('insight_kind', [
  'monthly_summary',
  'anomaly',
  'budget',
  'recurring',
]);
