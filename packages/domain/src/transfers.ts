import { daysBetween } from './dates.js';
import type { Agorot } from './money.js';

/**
 * Own-account transfers: an outflow in one of my accounts and the same inflow in another within a few
 * days, with transfer vocabulary or the counterpart's last digits in the description. Both legs are
 * excluded from income/expenses.
 */
export interface TransferLeg {
  id: string;
  accountId: string;
  txnDate: string;
  chargedAmountAgorot: Agorot;
  descriptionRaw: string;
}

export interface TransferPair {
  fromTxnId: string; // outflow
  toTxnId: string; // inflow
  confidence: number;
}

const vocabulary = /העברה|הע'|הפקדה|משיכה|transfer|bit|ביט|paybox|פייבוקס|לחשבון|מחשבון/iu;
export const TRANSFER_DATE_WINDOW_DAYS = 3;

export function detectTransfers(
  legs: readonly TransferLeg[],
  accountDigits: (accountId: string) => string | undefined,
): TransferPair[] {
  const outs = legs.filter((l) => l.chargedAmountAgorot < 0);
  const ins = legs.filter((l) => l.chargedAmountAgorot > 0);
  const usedIn = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const out of outs) {
    let best: { leg: TransferLeg; confidence: number } | undefined;
    for (const inn of ins) {
      if (usedIn.has(inn.id) || inn.accountId === out.accountId) continue;
      if (inn.chargedAmountAgorot !== -out.chargedAmountAgorot) continue;
      const dayDiff = Math.abs(daysBetween(out.txnDate, inn.txnDate));
      if (dayDiff > TRANSFER_DATE_WINDOW_DAYS) continue;
      let confidence = 0.5;
      const text = `${out.descriptionRaw} ${inn.descriptionRaw}`;
      if (vocabulary.test(text)) confidence += 0.25;
      const inDigits = accountDigits(inn.accountId);
      const outDigits = accountDigits(out.accountId);
      if (
        (inDigits && out.descriptionRaw.includes(inDigits)) ||
        (outDigits && inn.descriptionRaw.includes(outDigits))
      )
        confidence += 0.25;
      if (dayDiff === 0) confidence += 0.05;
      if (confidence < 0.75) continue; // amount+date alone is not enough (two unrelated equal amounts happen)
      if (!best || confidence > best.confidence)
        best = { leg: inn, confidence: Math.min(confidence, 1) };
    }
    if (best) {
      usedIn.add(best.leg.id);
      pairs.push({ fromTxnId: out.id, toTxnId: best.leg.id, confidence: best.confidence });
    }
  }
  return pairs;
}
