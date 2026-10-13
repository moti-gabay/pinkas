import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import * as e from './enums.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({ dataType: () => 'bytea' });
const agorot = (name: string) => bigint(name, { mode: 'number' });
const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: e.sourceKind('kind').notNull(),
  companyId: text('company_id'),
  displayName: text('display_name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  scheduleCron: text('schedule_cron'),
  /** Sticky, downgrade-only (trigger sources_hash_kind_no_upgrade). See ADR 0007. */
  hashKind: e.hashKind('hash_kind').notNull().default('identifier'),
  hashKindDowngradedAt: timestamp('hash_kind_downgraded_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorType: text('last_error_type'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  createdAt: now(),
});

export const credentials = pgTable('credentials', {
  sourceId: uuid('source_id')
    .primaryKey()
    .references(() => sources.id, { onDelete: 'cascade' }),
  /** libsodium sealed box of the JSON credential object. Only the sync-worker holds the private key. */
  ciphertext: bytea('ciphertext').notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    maskedLabel: text('masked_label').notNull(),
    type: e.accountType('type').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ILS'),
    displayName: text('display_name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    balanceAgorot: agorot('balance_agorot'),
    balanceAt: timestamp('balance_at', { withTimezone: true }),
    cardCycleDay: smallint('card_cycle_day'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('accounts_source_external_uq').on(t.sourceId, t.externalId)],
);

export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    balanceAgorot: agorot('balance_agorot').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.asOf] })],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id'),
  slug: text('slug').notNull().unique(),
  nameHe: text('name_he').notNull(),
  kind: e.categoryKind('kind').notNull(),
  isFixedDefault: boolean('is_fixed_default').notNull().default(false),
  icon: text('icon'),
  sort: smallint('sort').notNull().default(0),
  isSystem: boolean('is_system').notNull().default(false),
});

export const categoryRules = pgTable(
  'category_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pattern: text('pattern').notNull(),
    match: e.ruleMatch('match').notNull().default('contains'),
    field: e.ruleField('field').notNull().default('merchant_normalized'),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    isFixed: boolean('is_fixed'),
    priority: integer('priority').notNull().default(100),
    accountScope: uuid('account_scope').references(() => accounts.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    origin: e.ruleOrigin('origin').notNull().default('user'),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: now(),
  },
  (t) => [index('category_rules_enabled_priority_idx').on(t.enabled, t.priority)],
);

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    mime: text('mime').notNull(),
    parserId: text('parser_id'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    status: e.importStatus('status').notNull().default('uploaded'),
    llmMode: e.llmMode('llm_mode').notNull().default('none'),
    columnMapping: jsonb('column_mapping'),
    tableIndex: smallint('table_index').notNull().default(0),
    rowsParsed: integer('rows_parsed').notNull().default(0),
    rowsAdded: integer('rows_added').notNull().default(0),
    rowsSkipped: integer('rows_skipped').notNull().default(0),
    statementTotalAgorot: agorot('statement_total_agorot'),
    computedTotalAgorot: agorot('computed_total_agorot'),
    reconciled: boolean('reconciled'),
    error: text('error'),
    fileDeletedAt: timestamp('file_deleted_at', { withTimezone: true }),
    createdAt: now(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('imports_sha_committed_uq')
      .on(t.fileSha256)
      .where(sql`status = 'committed'`),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    dedupeHash: text('dedupe_hash').notNull(),
    hashVersion: smallint('hash_version').notNull().default(1),
    hashKind: e.hashKind('hash_kind').notNull(),
    previousHashes: text('previous_hashes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    origin: e.txnOrigin('origin').notNull(),
    importId: uuid('import_id').references(() => imports.id, { onDelete: 'set null' }),
    externalIdentifier: text('external_identifier'),
    txnDate: date('txn_date').notNull(),
    processedDate: date('processed_date'),
    chargedAmountAgorot: agorot('charged_amount_agorot').notNull(),
    originalAmountMinor: agorot('original_amount_minor'),
    originalCurrency: char('original_currency', { length: 3 }),
    status: e.txnStatus('status').notNull(),
    descriptionRaw: text('description_raw').notNull(),
    merchantNormalized: text('merchant_normalized').notNull(),
    memo: text('memo'),
    installmentNumber: smallint('installment_number'),
    installmentTotal: smallint('installment_total'),
    installmentGroupKey: text('installment_group_key'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    categorySource: e.categorySource('category_source'),
    categoryConfidence: numeric('category_confidence', { precision: 3, scale: 2 }),
    categoryRuleId: uuid('category_rule_id').references(() => categoryRules.id, {
      onDelete: 'set null',
    }),
    isFixed: boolean('is_fixed'),
    excludeReason: e.excludeReason('exclude_reason'),
    countedInCashflow: boolean('counted_in_cashflow')
      .notNull()
      .generatedAlwaysAs(sql`exclude_reason IS NULL`),
    stalePending: boolean('stale_pending').notNull().default(false),
    notes: text('notes'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    raw: jsonb('raw'),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('transactions_hash_uq').on(t.hashVersion, t.dedupeHash),
    index('transactions_account_ext_idx')
      .on(t.accountId, t.externalIdentifier)
      .where(sql`external_identifier IS NOT NULL`),
    index('transactions_account_date_idx').on(t.accountId, t.txnDate),
    index('transactions_date_counted_idx')
      .on(t.txnDate)
      .where(sql`exclude_reason IS NULL`),
    index('transactions_category_date_idx').on(t.categoryId, t.txnDate),
    index('transactions_merchant_idx').on(t.merchantNormalized),
    index('transactions_tags_idx').using('gin', t.tags),
    index('transactions_pending_idx')
      .on(t.status)
      .where(sql`status = 'pending'`),
    index('transactions_installment_group_idx').on(t.installmentGroupKey),
    check(
      'transactions_installment_pair_chk',
      sql`(installment_number IS NULL) = (installment_total IS NULL)`,
    ),
    check(
      'transactions_installment_range_chk',
      sql`installment_number IS NULL OR (installment_number >= 1 AND installment_number <= installment_total)`,
    ),
  ],
);

export const transactionLinks = pgTable(
  'transaction_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: e.linkKind('kind').notNull(),
    fromTxnId: uuid('from_txn_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    toTxnId: uuid('to_txn_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    createdBy: e.createdBy('created_by').notNull().default('system'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('transaction_links_uq').on(t.kind, t.fromTxnId, t.toTxnId)],
);

export const cardSettlements = pgTable('card_settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  bankTxnId: uuid('bank_txn_id')
    .notNull()
    .unique()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  cardAccountId: uuid('card_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  cycleDate: date('cycle_date').notNull(),
  expectedTotalAgorot: agorot('expected_total_agorot').notNull(),
  status: e.settlementStatus('status').notNull(),
  diffAgorot: agorot('diff_agorot').notNull().default(0),
  createdAt: now(),
});

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    amountAgorot: agorot('amount_agorot').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('budgets_category_from_uq').on(t.categoryId, t.effectiveFrom)],
);

export const expectedIncome = pgTable('expected_income', {
  month: date('month').primaryKey(),
  amountAgorot: agorot('amount_agorot').notNull(),
  note: text('note'),
  updatedAt: updatedAt(),
});

export const recurringSeries = pgTable(
  'recurring_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    merchantNormalized: text('merchant_normalized').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    cadence: e.cadence('cadence').notNull(),
    typicalAmountAgorot: agorot('typical_amount_agorot').notNull(),
    amountTolerancePct: smallint('amount_tolerance_pct').notNull().default(10),
    dayOfMonth: smallint('day_of_month'),
    firstSeen: date('first_seen').notNull(),
    lastSeen: date('last_seen').notNull(),
    nextExpected: date('next_expected'),
    occurrences: integer('occurrences').notNull(),
    status: e.recurringStatus('status').notNull().default('active'),
    isNew: boolean('is_new').notNull().default(false),
    userConfirmed: boolean('user_confirmed').notNull().default(false),
  },
  (t) => [uniqueIndex('recurring_series_uq').on(t.accountId, t.merchantNormalized, t.cadence)],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    trigger: e.syncTrigger('trigger').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: e.syncStatus('status').notNull().default('running'),
    errorType: text('error_type'),
    errorMessage: text('error_message'),
    accountsSeen: integer('accounts_seen').notNull().default(0),
    rowsAdded: integer('rows_added').notNull().default(0),
    rowsUpdated: integer('rows_updated').notNull().default(0),
    rowsLinked: integer('rows_linked').notNull().default(0),
    durationMs: integer('duration_ms'),
  },
  (t) => [index('sync_runs_source_started_idx').on(t.sourceId, t.startedAt)],
);

export const importRows = pgTable(
  'import_rows',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    raw: jsonb('raw').notNull(),
    parsed: jsonb('parsed'),
    dedupeHash: text('dedupe_hash'),
    decision: e.importDecision('decision'),
    error: text('error'),
  },
  (t) => [primaryKey({ columns: [t.importId, t.rowIndex] })],
);

export const insights = pgTable('insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  month: date('month').notNull(),
  kind: e.insightKind('kind').notNull(),
  facts: jsonb('facts').notNull(),
  contentHe: text('content_he').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: now(),
});

export const llmCalls = pgTable('llm_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  purpose: text('purpose').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  latencyMs: integer('latency_ms'),
  ok: boolean('ok').notNull(),
  error: text('error'),
  createdAt: now(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: now(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});
