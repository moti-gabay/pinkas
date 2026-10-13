import { daysBetween } from './dates.js';
import type { HashedTxn, StoredTxn } from './types.js';

/**
 * A completed incoming row with no exact hash match may be the posted version of an existing
 * pending row: same account, same frozen description key is too strict (banks reword on posting),
 * so we use merchantNormalized, a small date window and an amount tolerance (FX settlements drift).
 */
export const PENDING_DATE_WINDOW_DAYS = 4;
export const PENDING_AMOUNT_TOLERANCE_PCT = 2;
export const PENDING_AMOUNT_TOLERANCE_ABS = 500; // 5 ILS

export function amountsClose(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return (
    diff <= PENDING_AMOUNT_TOLERANCE_ABS || diff * 100 <= Math.abs(a) * PENDING_AMOUNT_TOLERANCE_PCT
  );
}

export function datesClose(a: string, b: string, window = PENDING_DATE_WINDOW_DAYS): boolean {
  return Math.abs(daysBetween(a, b)) <= window;
}

/** Picks the best pending candidate for an incoming completed row, or undefined. */
export function findPendingMatch(
  incoming: HashedTxn,
  pendingCandidates: readonly StoredTxn[],
): StoredTxn | undefined {
  if (incoming.status !== 'completed') return undefined;
  let best: { row: StoredTxn; score: number } | undefined;
  for (const p of pendingCandidates) {
    if (p.status !== 'pending' || p.accountId !== incoming.accountId) continue;
    if (p.merchantNormalized !== incoming.merchantNormalized) continue;
    if (Math.sign(p.chargedAmountAgorot) !== Math.sign(incoming.chargedAmountAgorot)) continue;
    if (!amountsClose(p.chargedAmountAgorot, incoming.chargedAmountAgorot)) continue;
    if (!datesClose(p.txnDate, incoming.txnDate)) continue;
    const score =
      Math.abs(p.chargedAmountAgorot - incoming.chargedAmountAgorot) +
      Math.abs(daysBetween(p.txnDate, incoming.txnDate)) * 100;
    if (!best || score < best.score) best = { row: p, score };
  }
  return best?.row;
}

export const STALE_PENDING_DAYS = 45;

export function isStalePending(row: Pick<StoredTxn, 'status' | 'txnDate'>, today: string): boolean {
  return row.status === 'pending' && daysBetween(row.txnDate, today) > STALE_PENDING_DAYS;
}
