import { monthOf, sum } from '@pinkas/domain';
import type { IsoMonth } from '@pinkas/domain';
import type { FixtureTxn, MonthExpectation } from './types.js';

/** Rows excluded from every total: card settlements and own transfers (transfer.*). */
export function isCounted(txn: FixtureTxn): boolean {
  return txn.tag !== 'card_settlement' && txn.tag !== 'transfer';
}

export function isIncomeSlug(slug: string): boolean {
  return slug === 'income' || slug.startsWith('income.');
}

/** Ground truth per month, derived from the rows (integer arithmetic only). */
export function computeExpectations(
  txns: readonly FixtureTxn[],
  months: readonly IsoMonth[],
): MonthExpectation[] {
  return months.map((month) => {
    const rows = txns.filter((t) => isCounted(t) && monthOf(t.txnDate) === month);
    const incomeRows = rows.filter(
      (t) => isIncomeSlug(t.expectedCategorySlug) && t.chargedAmountAgorot > 0,
    );
    const expenseRows = rows.filter((t) => !isIncomeSlug(t.expectedCategorySlug));
    const incomeAgorot = sum(incomeRows.map((t) => t.chargedAmountAgorot));
    const expensesAgorot = -sum(expenseRows.map((t) => t.chargedAmountAgorot));
    const fixedAgorot = -sum(
      expenseRows.filter((t) => t.isFixed).map((t) => t.chargedAmountAgorot),
    );
    const byCategory: Record<string, number> = {};
    for (const t of rows) {
      byCategory[t.expectedCategorySlug] = sum([
        byCategory[t.expectedCategorySlug] ?? 0,
        t.chargedAmountAgorot,
      ]);
    }
    return {
      month,
      incomeAgorot,
      expensesAgorot,
      netAgorot: incomeAgorot - expensesAgorot,
      byCategory,
      fixedAgorot,
      variableAgorot: expensesAgorot - fixedAgorot,
    };
  });
}
