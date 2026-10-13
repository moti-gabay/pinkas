import { describe, expect, it } from 'vitest';
import { findPendingMatch, isStalePending } from './pending-match.js';
import type { HashedTxn, StoredTxn } from './types.js';

const stored = (over: Partial<StoredTxn> = {}): StoredTxn => ({
  id: 'p1',
  accountId: 'card-1',
  dedupeHash: 'h',
  hashKind: 'fields',
  externalIdentifier: undefined,
  txnDate: '2026-03-05',
  processedDate: undefined,
  chargedAmountAgorot: -10000,
  status: 'pending',
  descriptionRaw: 'WOLT',
  merchantNormalized: 'wolt',
  categoryId: undefined,
  categorySource: undefined,
  isFixed: undefined,
  excludeReason: undefined,
  installmentNumber: undefined,
  installmentTotal: undefined,
  ...over,
});
const incoming = (over: Partial<HashedTxn> = {}): HashedTxn => ({
  accountId: 'card-1',
  origin: 'scraper',
  externalIdentifier: undefined,
  txnDate: '2026-03-07',
  processedDate: undefined,
  chargedAmountAgorot: -10150,
  originalAmountMinor: undefined,
  originalCurrency: undefined,
  status: 'completed',
  descriptionRaw: 'WOLT TLV',
  memo: undefined,
  installmentNumber: undefined,
  installmentTotal: undefined,
  dedupeHash: 'h2',
  hashKind: 'fields',
  hashVersion: 1,
  merchantNormalized: 'wolt',
  installmentGroupKey: undefined,
  ...over,
});

describe('findPendingMatch', () => {
  it('matches within ±4 days and ±2%/5₪', () => {
    expect(findPendingMatch(incoming(), [stored()])?.id).toBe('p1');
  });
  it('rejects beyond tolerance → new row', () => {
    expect(findPendingMatch(incoming({ txnDate: '2026-03-12' }), [stored()])).toBeUndefined();
    expect(findPendingMatch(incoming({ chargedAmountAgorot: -12000 }), [stored()])).toBeUndefined();
  });
  it('prefers the closest candidate and ignores other merchants/accounts/signs', () => {
    const cands = [
      stored({ id: 'far', chargedAmountAgorot: -10400 }),
      stored({ id: 'near', chargedAmountAgorot: -10150 }),
      stored({ id: 'other', merchantNormalized: 'paz' }),
      stored({ id: 'acc', accountId: 'x' }),
      stored({ id: 'refund', chargedAmountAgorot: 10150 }),
    ];
    expect(findPendingMatch(incoming(), cands)?.id).toBe('near');
  });
  it('never matches pending incoming rows', () => {
    expect(findPendingMatch(incoming({ status: 'pending' }), [stored()])).toBeUndefined();
  });
});

describe('isStalePending', () => {
  it('flags pending rows older than 45 days', () => {
    expect(isStalePending(stored(), '2026-04-25')).toBe(true);
    expect(isStalePending(stored(), '2026-04-10')).toBe(false);
    expect(isStalePending(stored({ status: 'completed' }), '2026-06-01')).toBe(false);
  });
});
