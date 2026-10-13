import { describe, expect, it } from 'vitest';
import { matchRefunds } from './refunds.js';

describe('matchRefunds', () => {
  const purchase = {
    id: 'p1',
    accountId: 'card',
    txnDate: '2026-02-20',
    chargedAmountAgorot: -10000,
    merchantNormalized: 'zara',
    categoryId: 'clothing',
    refundedSoFarAgorot: 0,
  };
  it('links partial and full refunds to the nearest earlier purchase, within capacity', () => {
    const matches = matchRefunds(
      [
        {
          id: 'r1',
          accountId: 'card',
          txnDate: '2026-03-05',
          chargedAmountAgorot: 4000,
          merchantNormalized: 'zara',
        },
        {
          id: 'r2',
          accountId: 'card',
          txnDate: '2026-03-06',
          chargedAmountAgorot: 6000,
          merchantNormalized: 'zara',
        },
        {
          id: 'r3',
          accountId: 'card',
          txnDate: '2026-03-07',
          chargedAmountAgorot: 100,
          merchantNormalized: 'zara',
        }, // over capacity
        {
          id: 'r4',
          accountId: 'card',
          txnDate: '2026-07-01',
          chargedAmountAgorot: 100,
          merchantNormalized: 'zara',
        }, // too late
        {
          id: 'r5',
          accountId: 'other',
          txnDate: '2026-03-07',
          chargedAmountAgorot: 100,
          merchantNormalized: 'zara',
        },
      ],
      [purchase, { ...purchase, id: 'p0', txnDate: '2026-01-01' }],
    );
    expect(matches).toEqual([
      { refundTxnId: 'r1', purchaseTxnId: 'p1', categoryId: 'clothing' },
      { refundTxnId: 'r2', purchaseTxnId: 'p1', categoryId: 'clothing' },
      { refundTxnId: 'r3', purchaseTxnId: 'p0', categoryId: 'clothing' },
    ]);
  });
});
