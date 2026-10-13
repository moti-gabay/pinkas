import { describe, expect, it } from 'vitest';
import { detectTransfers, type TransferLeg } from './transfers.js';

const leg = (over: Partial<TransferLeg> & { id: string }): TransferLeg => ({
  accountId: 'chk',
  txnDate: '2026-03-10',
  chargedAmountAgorot: -300000,
  descriptionRaw: '',
  ...over,
});
const digits = (id: string) => ({ chk: '1234', sav: '5678' })[id];

describe('detectTransfers', () => {
  it('pairs vocabulary-backed legs across accounts and ignores same-amount coincidences', () => {
    const pairs = detectTransfers(
      [
        leg({ id: 'o1', descriptionRaw: 'העברה לחשבון ****5678' }),
        leg({
          id: 'i1',
          accountId: 'sav',
          chargedAmountAgorot: 300000,
          txnDate: '2026-03-11',
          descriptionRaw: 'העברה מחשבון ****1234',
        }),
        leg({ id: 'o2', descriptionRaw: 'שופרסל', chargedAmountAgorot: -5000 }),
        leg({ id: 'i2', accountId: 'sav', chargedAmountAgorot: 5000, descriptionRaw: 'ריבית' }),
        leg({
          id: 'o3',
          descriptionRaw: 'העברה',
          chargedAmountAgorot: -100,
          txnDate: '2026-03-01',
        }),
        leg({
          id: 'i3',
          accountId: 'sav',
          chargedAmountAgorot: 100,
          descriptionRaw: 'הפקדה',
          txnDate: '2026-03-20',
        }),
      ],
      digits,
    );
    expect(pairs).toEqual([{ fromTxnId: 'o1', toTxnId: 'i1', confidence: 1 }]);
  });
  it('never pairs legs in the same account', () => {
    expect(
      detectTransfers(
        [
          leg({ id: 'a', descriptionRaw: 'העברה' }),
          leg({ id: 'b', chargedAmountAgorot: 300000, descriptionRaw: 'העברה' }),
        ],
        digits,
      ),
    ).toEqual([]);
  });
});
