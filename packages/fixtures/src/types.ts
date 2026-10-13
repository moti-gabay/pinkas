import type { IsoMonth, NormalizedTxn } from '@pinkas/domain';

export interface FixtureAccount {
  id: string;
  type: 'checking' | 'credit_card';
  companyId: 'beinleumi' | 'max' | 'visaCal' | 'isracard';
  /** Synthetic: bank account number or card last-4. */
  externalId: string;
  displayName: string;
  cardCycleDay?: number;
}

export type FixtureTag =
  | 'income'
  | 'rent'
  | 'arnona'
  | 'standing_order'
  | 'card_purchase'
  | 'installment'
  | 'refund'
  | 'card_settlement'
  | 'transfer'
  | 'fx'
  | 'fee'
  | 'subscription';

export interface FixtureTxn extends NormalizedTxn {
  /** Ground truth for categorization tests. */
  expectedCategorySlug: string;
  isFixed: boolean;
  tag: FixtureTag;
  /** Links the two legs of a transfer, a refund to its purchase, installments of one plan, a settlement to its cycle. */
  counterpartKey?: string;
}

export interface MonthExpectation {
  month: IsoMonth;
  incomeAgorot: number;
  /** Positive magnitude of counted outflows (refunds reduce it). */
  expensesAgorot: number;
  netAgorot: number;
  /** slug → signed agorot */
  byCategory: Record<string, number>;
  fixedAgorot: number;
  variableAgorot: number;
}

export interface Household {
  accounts: FixtureAccount[];
  transactions: FixtureTxn[];
  expectations: MonthExpectation[];
  seed: number;
}

export interface GenerateOptions {
  /** Default 12. */
  months?: number;
  /** YYYY-MM; default: current month in Asia/Jerusalem. */
  endMonth?: IsoMonth;
  /** Default 42. */
  seed?: number;
}
