import { describe, expect, it } from 'vitest';
import { buildCycles, issuerOf, matchSettlements } from './card-link.js';

describe('card-link', () => {
  const issuer = (id: string) => ({ max1: 'max', cal1: 'visaCal' })[id];
  it('recognises issuers in bank descriptions', () => {
    expect(issuerOf('מקס איט פיננסים')).toBe('max');
    expect(issuerOf('כאל')).toBe('visaCal');
    expect(issuerOf('שופרסל')).toBeUndefined();
  });
  it('builds cycles by processed date and matches exact debits', () => {
    const cycles = buildCycles([
      {
        accountId: 'max1',
        processedDate: '2026-03-10',
        txnDate: '2026-02-14',
        chargedAmountAgorot: -10000,
      },
      {
        accountId: 'max1',
        processedDate: '2026-03-10',
        txnDate: '2026-02-20',
        chargedAmountAgorot: -2500,
      },
      {
        accountId: 'max1',
        processedDate: '2026-03-10',
        txnDate: '2026-02-22',
        chargedAmountAgorot: 500,
      }, // refund
      {
        accountId: 'cal1',
        processedDate: '2026-03-02',
        txnDate: '2026-02-01',
        chargedAmountAgorot: -7000,
      },
    ]);
    expect(cycles).toHaveLength(2);
    const matches = matchSettlements(
      [
        {
          id: 'b1',
          txnDate: '2026-03-10',
          chargedAmountAgorot: -12000,
          merchantNormalized: 'מקס איט פיננסים',
        },
        { id: 'b2', txnDate: '2026-03-03', chargedAmountAgorot: -6900, merchantNormalized: 'כאל' },
        {
          id: 'b3',
          txnDate: '2026-03-10',
          chargedAmountAgorot: -12000,
          merchantNormalized: 'שופרסל',
        },
        { id: 'b4', txnDate: '2026-03-20', chargedAmountAgorot: -12000, merchantNormalized: 'מקס' },
      ],
      cycles,
      issuer,
    );
    expect(matches).toEqual([
      {
        bankTxnId: 'b1',
        cardAccountId: 'max1',
        cycleDate: '2026-03-10',
        expectedTotalAgorot: -12000,
        diffAgorot: 0,
        status: 'matched',
      },
      {
        bankTxnId: 'b2',
        cardAccountId: 'cal1',
        cycleDate: '2026-03-02',
        expectedTotalAgorot: -7000,
        diffAgorot: 100,
        status: 'partial',
      },
    ]);
  });
});
