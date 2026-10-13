/**
 * FROZEN. The dedupe hash decides row identity across syncs and imports; if its output changes,
 * every existing row becomes a duplicate on the next sync. Rules:
 *  - never import normalize-merchant (or anything that evolves) here;
 *  - any change bumps HASH_VERSION and ships with a recompute migration + golden-file update.
 *
 * Which kind a row gets is decided by `sources.hash_kind` (sticky, downgrade-only), never per batch.
 */
import type { HashKind, NormalizedTxn } from './types.js';

export const HASH_VERSION = 1;

/** Minimal, frozen description key: NFKC, strip bidi/zero-width marks, collapse whitespace, trim. Nothing else. */
export function descriptionKey(descriptionRaw: string): string {
  return descriptionRaw
    .normalize('NFKC')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

const trivialIdentifiers = new Set(['', '0', '-', '00', '000', 'null', 'undefined']);

export function usableIdentifier(id: string | number | undefined): string | undefined {
  if (id === undefined) return undefined;
  const s = String(id).trim();
  if (trivialIdentifiers.has(s.toLowerCase())) return undefined;
  if (s.length >= 2 && /^(.)\1*$/.test(s)) return undefined; // "0000", "----"
  return s;
}

export type Sha256 = (input: string) => string;

export interface HashedRow {
  dedupeHash: string;
  hashKind: HashKind;
  hashVersion: number;
}

function fieldsKey(t: NormalizedTxn, ordinal: number): string {
  return [
    'v1',
    'f',
    t.accountId,
    t.txnDate,
    String(t.chargedAmountAgorot),
    descriptionKey(t.descriptionRaw),
    String(ordinal),
  ].join('|');
}

function identifierKey(accountId: string, id: string): string {
  return ['v1', 'id', accountId, id].join('|');
}

/**
 * Hashes a batch. `sourceHashKind` is the source's sticky setting. Rows without a usable identifier
 * always get a fields hash. Ordinals are assigned per identical (account, date, amount, descriptionKey)
 * group in batch order so two genuine identical purchases survive while re-imports stay idempotent.
 */
export function hashBatch<T extends NormalizedTxn>(
  rows: T[],
  sourceHashKind: HashKind,
  sha256: Sha256,
): (T & HashedRow)[] {
  const ordinals = new Map<string, number>();
  return rows.map((t) => {
    const id = usableIdentifier(t.externalIdentifier);
    if (sourceHashKind === 'identifier' && id !== undefined) {
      return {
        ...t,
        dedupeHash: sha256(identifierKey(t.accountId, id)),
        hashKind: 'identifier' as const,
        hashVersion: HASH_VERSION,
      };
    }
    const groupKey = fieldsKey({ ...t }, 0).replace(/\|0$/, '');
    const ordinal = ordinals.get(groupKey) ?? 0;
    ordinals.set(groupKey, ordinal + 1);
    return {
      ...t,
      dedupeHash: sha256(fieldsKey(t, ordinal)),
      hashKind: 'fields' as const,
      hashVersion: HASH_VERSION,
    };
  });
}

/**
 * Detects whether a batch proves the source's identifiers are not unique: the same identifier on rows
 * with a different (date, amount). `existing` lets the caller include already-stored rows of the source.
 */
export function identifiersCollide(
  rows: readonly Pick<
    NormalizedTxn,
    'accountId' | 'externalIdentifier' | 'txnDate' | 'chargedAmountAgorot'
  >[],
  amountTolerance: (a: number, b: number) => boolean = (a, b) => a === b,
  dateTolerance: (a: string, b: string) => boolean = (a, b) => a === b,
): boolean {
  const seen = new Map<string, { txnDate: string; amount: number }>();
  for (const r of rows) {
    const id = usableIdentifier(r.externalIdentifier);
    if (id === undefined) continue;
    const key = `${r.accountId}|${id}`;
    const prev = seen.get(key);
    if (
      prev &&
      !(
        amountTolerance(prev.amount, r.chargedAmountAgorot) &&
        dateTolerance(prev.txnDate, r.txnDate)
      )
    )
      return true;
    if (!prev) seen.set(key, { txnDate: r.txnDate, amount: r.chargedAmountAgorot });
  }
  return false;
}
