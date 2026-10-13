import { assertAgorot, type Agorot } from './money.js';

/** The subset of a stored row the summary needs. Only rows with no excludeReason are counted. */
export interface SummaryRow {
  txnDate: string;
  chargedAmountAgorot: Agorot;
  categoryId: string | undefined;
  categoryKind: 'expense' | 'income' | 'transfer' | undefined;
  isFixed: boolean;
  excludeReason: string | undefined;
}

export interface MonthSummary {
  month: string;
  incomeAgorot: Agorot; // positive
  expensesAgorot: Agorot; // positive magnitude; refunds reduce it
  netAgorot: Agorot;
  fixedAgorot: Agorot; // positive magnitude
  variableAgorot: Agorot;
  byCategory: Record<string, Agorot>; // signed sums; expense categories negative
  countedRows: number;
}

/**
 * Income = inflows on income-kind categories. Everything else that is counted is spending; a positive
 * amount in an expense category (refund) reduces spending rather than adding income.
 * Uncategorized rows follow their sign: inflow → income, outflow → expense.
 */
export function summarizeMonth(rows: readonly SummaryRow[], month: string): MonthSummary {
  let income = 0;
  let spending = 0; // signed, negative
  let fixed = 0;
  let variable = 0;
  const byCategory: Record<string, Agorot> = {};
  let counted = 0;
  for (const r of rows) {
    if (r.excludeReason !== undefined || !r.txnDate.startsWith(month)) continue;
    if (r.categoryKind === 'transfer') continue;
    const amt = assertAgorot(r.chargedAmountAgorot);
    counted++;
    const key = r.categoryId ?? 'uncategorized';
    byCategory[key] = (byCategory[key] ?? 0) + amt;
    const isIncome = r.categoryKind === 'income' || (r.categoryKind === undefined && amt > 0);
    if (isIncome) {
      income += amt;
    } else {
      spending += amt;
      if (r.isFixed) fixed += amt;
      else variable += amt;
    }
  }
  return {
    month,
    incomeAgorot: income,
    expensesAgorot: 0 - spending,
    netAgorot: income + spending,
    fixedAgorot: 0 - fixed,
    variableAgorot: 0 - variable,
    byCategory,
    countedRows: counted,
  };
}
