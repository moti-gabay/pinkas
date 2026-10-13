import { describe, expect, it } from 'vitest';
import { summarizeMonth, type SummaryRow } from './month-summary.js';

const row = (over: Partial<SummaryRow>): SummaryRow => ({
  txnDate: '2026-03-10',
  chargedAmountAgorot: -1000,
  categoryId: 'food',
  categoryKind: 'expense',
  isFixed: false,
  excludeReason: undefined,
  ...over,
});

describe('summarizeMonth', () => {
  it('computes income, expenses, net, fixed/variable and excludes linked rows', () => {
    const s = summarizeMonth(
      [
        row({
          chargedAmountAgorot: 1_000_000,
          categoryId: 'income.freelance',
          categoryKind: 'income',
        }),
        row({ chargedAmountAgorot: -400_000, categoryId: 'housing.rent', isFixed: true }),
        row({ chargedAmountAgorot: -30_000 }),
        row({ chargedAmountAgorot: 5_000 }), // refund in food
        row({ chargedAmountAgorot: -999_999, excludeReason: 'card_settlement' }),
        row({ chargedAmountAgorot: -50_000, categoryId: 'transfer.own', categoryKind: 'transfer' }),
        row({ chargedAmountAgorot: -70_000, txnDate: '2026-04-01' }),
        row({ chargedAmountAgorot: 2_000, categoryId: undefined, categoryKind: undefined }),
      ],
      '2026-03',
    );
    expect(s.incomeAgorot).toBe(1_002_000);
    expect(s.expensesAgorot).toBe(425_000);
    expect(s.netAgorot).toBe(577_000);
    expect(s.fixedAgorot).toBe(400_000);
    expect(s.variableAgorot).toBe(25_000);
    expect(s.byCategory).toEqual({
      'income.freelance': 1_000_000,
      'housing.rent': -400_000,
      food: -25_000,
      uncategorized: 2_000,
    });
    expect(s.countedRows).toBe(5);
  });
  it('handles an empty month', () => {
    expect(summarizeMonth([], '2026-01')).toMatchObject({
      incomeAgorot: 0,
      expensesAgorot: 0,
      netAgorot: 0,
      countedRows: 0,
    });
  });
});
