import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HASH_VERSION,
  descriptionKey,
  hashBatch,
  identifiersCollide,
  usableIdentifier,
} from './dedupe-hash.js';
import type { NormalizedTxn } from './types.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const txn = (over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  accountId: 'acc-1',
  origin: 'import',
  externalIdentifier: undefined,
  txnDate: '2026-03-07',
  processedDate: undefined,
  chargedAmountAgorot: -12345,
  originalAmountMinor: undefined,
  originalCurrency: undefined,
  status: 'completed',
  descriptionRaw: 'שופרסל דיל סניף רמת גן',
  memo: undefined,
  installmentNumber: undefined,
  installmentTotal: undefined,
  ...over,
});

describe('descriptionKey (frozen)', () => {
  it('only strips bidi marks and collapses whitespace', () => {
    expect(descriptionKey('\u200f שופרסל   דיל\u00a0סניף ')).toBe('שופרסל דיל סניף');
    expect(descriptionKey('Netflix.COM')).toBe('Netflix.COM'); // no lowercasing
    expect(descriptionKey('פז 1234')).toBe('פז 1234'); // no digit stripping
  });
});

describe('hashBatch', () => {
  it('keeps two genuine identical purchases and is idempotent on re-import', () => {
    const batch = [txn(), txn()];
    const a = hashBatch(batch, 'identifier', sha256);
    const b = hashBatch(batch, 'identifier', sha256);
    expect(a[0]!.dedupeHash).not.toBe(a[1]!.dedupeHash);
    expect(a.map((r) => r.dedupeHash)).toEqual(b.map((r) => r.dedupeHash));
    expect(a.every((r) => r.hashKind === 'fields' && r.hashVersion === HASH_VERSION)).toBe(true);
  });
  it('uses the identifier when the source allows it and ignores trivial identifiers', () => {
    const [withId] = hashBatch([txn({ externalIdentifier: '98765' })], 'identifier', sha256);
    const [trivial] = hashBatch([txn({ externalIdentifier: '0' })], 'identifier', sha256);
    expect(withId!.hashKind).toBe('identifier');
    expect(trivial!.hashKind).toBe('fields');
    const [downgraded] = hashBatch([txn({ externalIdentifier: '98765' })], 'fields', sha256);
    expect(downgraded!.hashKind).toBe('fields');
  });
  it('identifier hash survives amount/date changes (pending→completed)', () => {
    const [p] = hashBatch(
      [txn({ externalIdentifier: 'A1', status: 'pending', chargedAmountAgorot: -100 })],
      'identifier',
      sha256,
    );
    const [c] = hashBatch(
      [
        txn({
          externalIdentifier: 'A1',
          status: 'completed',
          chargedAmountAgorot: -102,
          txnDate: '2026-03-09',
        }),
      ],
      'identifier',
      sha256,
    );
    expect(p!.dedupeHash).toBe(c!.dedupeHash);
  });
  it('matches the golden file (hash stability across releases)', () => {
    const golden = JSON.parse(
      readFileSync(new URL('./dedupe-hash.golden.json', import.meta.url), 'utf8'),
    ) as { desc: string; id?: string; amount: number; date: string; hash: string }[];
    expect(golden.length).toBeGreaterThan(20);
    const rows = golden.map((g) =>
      txn({
        descriptionRaw: g.desc,
        externalIdentifier: g.id,
        chargedAmountAgorot: g.amount,
        txnDate: g.date,
      }),
    );
    const hashed = hashBatch(rows, 'identifier', sha256);
    hashed.forEach((h, i) => {
      expect(h.dedupeHash, golden[i]!.desc).toBe(golden[i]!.hash);
    });
  });
  it('does not depend on normalize-merchant (source-level guard)', () => {
    const src = readFileSync(new URL('./dedupe-hash.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"][^'"]*normalize-merchant/);
  });
});

describe('usableIdentifier / identifiersCollide', () => {
  it('rejects trivial ids', () => {
    expect(usableIdentifier('0000')).toBeUndefined();
    expect(usableIdentifier(' 12 ')).toBe('12');
    expect(usableIdentifier(42)).toBe('42');
  });
  it('detects reused identifiers with different amount/date', () => {
    expect(
      identifiersCollide([txn({ externalIdentifier: 'X' }), txn({ externalIdentifier: 'X' })]),
    ).toBe(false);
    expect(
      identifiersCollide([
        txn({ externalIdentifier: 'X' }),
        txn({ externalIdentifier: 'X', chargedAmountAgorot: -1 }),
      ]),
    ).toBe(true);
    expect(
      identifiersCollide([
        txn({ externalIdentifier: 'X', accountId: 'a' }),
        txn({ externalIdentifier: 'X', accountId: 'b', chargedAmountAgorot: -1 }),
      ]),
    ).toBe(false);
  });
});
