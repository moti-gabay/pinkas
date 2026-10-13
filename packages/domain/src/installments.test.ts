import { describe, expect, it } from 'vitest';
import { installmentGroupKey, parseInstallmentText } from './installments.js';
import type { NormalizedTxn } from './types.js';

const base: NormalizedTxn = {
  accountId: 'card',
  origin: 'scraper',
  externalIdentifier: undefined,
  txnDate: '2027-01-10',
  processedDate: undefined,
  chargedAmountAgorot: -10000,
  originalAmountMinor: undefined,
  originalCurrency: undefined,
  status: 'completed',
  descriptionRaw: 'KSP',
  memo: undefined,
  installmentNumber: 3,
  installmentTotal: 12,
};

describe('installments', () => {
  it('group key points at the first charge month across a year boundary', () => {
    expect(installmentGroupKey(base, 'ksp')).toBe('card|ksp|12|2026-11');
    expect(
      installmentGroupKey({ ...base, installmentNumber: 1, txnDate: '2026-11-10' }, 'ksp'),
    ).toBe('card|ksp|12|2026-11');
    expect(
      installmentGroupKey(
        { ...base, installmentNumber: undefined, installmentTotal: undefined },
        'ksp',
      ),
    ).toBeUndefined();
  });
  it.each([
    ['תשלום 3 מתוך 12', { number: 3, total: 12 }],
    ["תש' 1 מ-6", { number: 1, total: 6 }],
    ['2/10 תשלומים', { number: 2, total: 10 }],
    ['קרדיט 4/8', { number: 4, total: 8 }],
    ['תשלום 13 מתוך 12', undefined],
    ['רגיל', undefined],
  ])('parses %s', (text, expected) => {
    expect(parseInstallmentText(text)).toEqual(expected);
  });
});
