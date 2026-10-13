import { daysBetween } from './dates.js';
import type { Agorot } from './money.js';

/**
 * Refund matching on card accounts: a positive amount whose merchant had an earlier purchase of at least
 * that size within 120 days inherits the purchase's category (offsetting it), and is never income.
 */
export const REFUND_WINDOW_DAYS = 120;

export interface RefundCandidate {
  id: string;
  accountId: string;
  txnDate: string;
  chargedAmountAgorot: Agorot;
  merchantNormalized: string;
}

export interface PurchaseCandidate extends RefundCandidate {
  categoryId: string | undefined;
  refundedSoFarAgorot: Agorot; // positive sum of refunds already linked
}

export interface RefundMatch {
  refundTxnId: string;
  purchaseTxnId: string;
  categoryId: string | undefined;
}

export function matchRefunds(
  refunds: readonly RefundCandidate[],
  purchases: readonly PurchaseCandidate[],
): RefundMatch[] {
  const remaining = new Map(
    purchases.map((p) => [p.id, -p.chargedAmountAgorot - p.refundedSoFarAgorot]),
  );
  const out: RefundMatch[] = [];
  for (const r of refunds) {
    if (r.chargedAmountAgorot <= 0) continue;
    let best: { p: PurchaseCandidate; days: number } | undefined;
    for (const p of purchases) {
      if (
        p.accountId !== r.accountId ||
        p.merchantNormalized !== r.merchantNormalized ||
        p.chargedAmountAgorot >= 0
      )
        continue;
      const days = daysBetween(p.txnDate, r.txnDate);
      if (days < 0 || days > REFUND_WINDOW_DAYS) continue;
      if ((remaining.get(p.id) ?? 0) < r.chargedAmountAgorot) continue;
      if (!best || days < best.days) best = { p, days };
    }
    if (!best) continue;
    remaining.set(best.p.id, (remaining.get(best.p.id) ?? 0) - r.chargedAmountAgorot);
    out.push({ refundTxnId: r.id, purchaseTxnId: best.p.id, categoryId: best.p.categoryId });
  }
  return out;
}
