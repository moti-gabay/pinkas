import { z } from 'zod';
import { companyIds } from './scrapers.js';

/** API contracts shared by api and web. Amounts are integer agorot; dates are YYYY-MM-DD; months are YYYY-MM. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM');
export const agorot = z.number().int();
export const uuid = z.uuid();

// auth
export const passwordBody = z.object({ password: z.string().min(10).max(200) });
export const authStatus = z.object({ authenticated: z.boolean(), setupRequired: z.boolean() });

// sources & accounts
export const accountType = z.enum(['checking', 'credit_card', 'savings']);
export const sourceDto = z.object({
  id: uuid,
  kind: z.enum(['scraper', 'file']),
  companyId: z.enum(companyIds).nullable(),
  displayName: z.string(),
  enabled: z.boolean(),
  hashKind: z.enum(['identifier', 'fields']),
  lastSuccessAt: z.string().nullable(),
  lastErrorType: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
});
export const accountDto = z.object({
  id: uuid,
  sourceId: uuid,
  maskedLabel: z.string(),
  type: accountType,
  currency: z.string(),
  displayName: z.string(),
  isActive: z.boolean(),
  balanceAgorot: agorot.nullable(),
  balanceAt: z.string().nullable(),
  cardCycleDay: z.number().int().min(1).max(31).nullable(),
});
export const createFileSourceBody = z.object({
  displayName: z.string().min(1).max(100),
  account: z.object({
    displayName: z.string().min(1).max(100),
    type: accountType,
    externalId: z.string().min(1).max(60),
    cardCycleDay: z.number().int().min(1).max(31).optional(),
  }),
});
export const updateAccountBody = z.object({
  displayName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  cardCycleDay: z.number().int().min(1).max(31).nullable().optional(),
});

// categories & rules
export const categoryDto = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  slug: z.string(),
  nameHe: z.string(),
  kind: z.enum(['expense', 'income', 'transfer']),
  isFixedDefault: z.boolean(),
  icon: z.string().nullable(),
  sort: z.number().int(),
  isSystem: z.boolean(),
});
export const ruleMatch = z.enum(['contains', 'exact', 'regex', 'prefix']);
export const ruleField = z.enum(['merchant_normalized', 'description_raw']);
export const ruleDto = z.object({
  id: uuid,
  pattern: z.string(),
  match: ruleMatch,
  field: ruleField,
  categoryId: uuid,
  isFixed: z.boolean().nullable(),
  priority: z.number().int(),
  accountScope: uuid.nullable(),
  enabled: z.boolean(),
  origin: z.enum(['seed', 'user', 'learned']),
  hitCount: z.number().int(),
});
export const createRuleBody = z.object({
  pattern: z.string().min(1).max(200),
  match: ruleMatch.default('contains'),
  field: ruleField.default('merchant_normalized'),
  categoryId: uuid,
  isFixed: z.boolean().nullable().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  accountScope: uuid.nullable().optional(),
  origin: z.enum(['user', 'learned']).default('user'),
  /** Re-categorize existing rule/default-categorized rows that match. Manual choices are never overwritten. */
  applyToExisting: z.boolean().default(true),
});
export const updateRuleBody = createRuleBody.partial().omit({ origin: true });

// transactions
export const transactionDto = z.object({
  id: uuid,
  accountId: uuid,
  txnDate: isoDate,
  processedDate: isoDate.nullable(),
  chargedAmountAgorot: agorot,
  originalAmountMinor: agorot.nullable(),
  originalCurrency: z.string().nullable(),
  status: z.enum(['pending', 'completed']),
  descriptionRaw: z.string(),
  merchantNormalized: z.string(),
  memo: z.string().nullable(),
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  categoryId: uuid.nullable(),
  categorySource: z.enum(['rule', 'ai', 'manual', 'refund_link', 'default']).nullable(),
  categoryConfidence: z.number().nullable(),
  isFixed: z.boolean().nullable(),
  excludeReason: z.enum(['card_settlement', 'internal_transfer', 'duplicate', 'user']).nullable(),
  stalePending: z.boolean(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
});
export const transactionsQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: uuid.optional(),
  categoryId: uuid.optional(),
  q: z.string().max(100).optional(),
  uncategorized: z.coerce.boolean().optional(),
  includeExcluded: z.coerce.boolean().default(false),
  tag: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
});
export const updateTransactionBody = z.object({
  categoryId: uuid.nullable().optional(),
  isFixed: z.boolean().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  excludeReason: z.enum(['user']).nullable().optional(),
});
export const transactionsPage = z.object({
  items: z.array(transactionDto),
  total: z.number().int(),
});

// reports
export const monthReportDto = z.object({
  month: isoMonth,
  incomeAgorot: agorot,
  expensesAgorot: agorot,
  netAgorot: agorot,
  fixedAgorot: agorot,
  variableAgorot: agorot,
  countedRows: z.number().int(),
  byCategory: z.array(
    z.object({
      categoryId: uuid.nullable(),
      slug: z.string(),
      nameHe: z.string(),
      parentId: uuid.nullable(),
      kind: z.enum(['expense', 'income', 'transfer']),
      amountAgorot: agorot,
      txnCount: z.number().int(),
    }),
  ),
  previous: z
    .object({ incomeAgorot: agorot, expensesAgorot: agorot, netAgorot: agorot })
    .nullable(),
  avg3: z.object({ incomeAgorot: agorot, expensesAgorot: agorot, netAgorot: agorot }).nullable(),
  avg6: z.object({ incomeAgorot: agorot, expensesAgorot: agorot, netAgorot: agorot }).nullable(),
});

export type SourceDto = z.infer<typeof sourceDto>;
export type AccountDto = z.infer<typeof accountDto>;
export type CategoryDto = z.infer<typeof categoryDto>;
export type RuleDto = z.infer<typeof ruleDto>;
export type TransactionDto = z.infer<typeof transactionDto>;
export type TransactionsQuery = z.infer<typeof transactionsQuery>;
export type MonthReportDto = z.infer<typeof monthReportDto>;
export type AuthStatus = z.infer<typeof authStatus>;
