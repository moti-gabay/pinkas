import { daysBetween } from './dates.js';
import type { Agorot } from './money.js';

/**
 * Credit-card settlement linking: the bank shows one aggregated debit per billing cycle, the card
 * account shows the individual purchases. The bank debit is excluded from spending (it would double
 * count) and tied to the cycle it pays for.
 */
export interface CardCycle {
  cardAccountId: string;
  cycleDate: string; // processed_date shared by the card rows of the cycle
  totalAgorot: Agorot; // signed sum of card rows (negative = net charge)
}

export interface BankDebitCandidate {
  id: string;
  txnDate: string;
  chargedAmountAgorot: Agorot;
  merchantNormalized: string;
}

export interface SettlementMatch {
  bankTxnId: string;
  cardAccountId: string;
  cycleDate: string;
  expectedTotalAgorot: Agorot;
  diffAgorot: Agorot;
  status: 'matched' | 'partial';
}

/** Issuer vocabulary as it appears in bank descriptions. Extend from real statements. */
export const issuerPatterns: readonly { companyId: string; patterns: RegExp[] }[] = [
  { companyId: 'max', patterns: [/מקס/u, /\bmax\b/iu, /לאומי קארד/u] },
  {
    companyId: 'visaCal',
    patterns: [/(^|\s)כאל(\s|$)/u, /\bcal\b/iu, /ויזה כאל/u, /כרטיסי אשראי לישראל/u],
  },
  { companyId: 'isracard', patterns: [/ישראכרט/u, /isracard/iu, /מסטרקארד/u, /פועלים אקספרס/u] },
  { companyId: 'amex', patterns: [/אמריקן אקספרס/u, /amex/iu] },
];

export function issuerOf(merchantNormalized: string): string | undefined {
  return issuerPatterns.find((i) => i.patterns.some((p) => p.test(merchantNormalized)))?.companyId;
}

export const SETTLEMENT_DATE_WINDOW_DAYS = 3;

/** Groups card rows (any status) by processed date → cycle totals. */
export function buildCycles(
  cardRows: readonly {
    accountId: string;
    processedDate: string | undefined;
    txnDate: string;
    chargedAmountAgorot: Agorot;
  }[],
): CardCycle[] {
  const map = new Map<string, CardCycle>();
  for (const r of cardRows) {
    const cycleDate = r.processedDate ?? r.txnDate;
    const key = `${r.accountId}|${cycleDate}`;
    const c = map.get(key) ?? { cardAccountId: r.accountId, cycleDate, totalAgorot: 0 };
    c.totalAgorot += r.chargedAmountAgorot;
    map.set(key, c);
  }
  return [...map.values()];
}

/**
 * For each bank debit that looks like a card charge, find the cycle (of a card from that issuer) with
 * the closest date; exact amount → matched, otherwise partial (still excluded, surfaced to the user).
 */
export function matchSettlements(
  bankDebits: readonly BankDebitCandidate[],
  cycles: readonly CardCycle[],
  cardIssuer: (cardAccountId: string) => string | undefined,
): SettlementMatch[] {
  const used = new Set<string>();
  const out: SettlementMatch[] = [];
  for (const debit of bankDebits) {
    if (debit.chargedAmountAgorot >= 0) continue;
    const issuer = issuerOf(debit.merchantNormalized);
    if (!issuer) continue;
    let best: { cycle: CardCycle; score: number } | undefined;
    for (const cycle of cycles) {
      if (cardIssuer(cycle.cardAccountId) !== issuer) continue;
      const key = `${cycle.cardAccountId}|${cycle.cycleDate}`;
      if (used.has(key)) continue;
      const dayDiff = Math.abs(daysBetween(cycle.cycleDate, debit.txnDate));
      if (dayDiff > SETTLEMENT_DATE_WINDOW_DAYS) continue;
      const amountDiff = Math.abs(cycle.totalAgorot - debit.chargedAmountAgorot);
      const score = amountDiff * 10 + dayDiff;
      if (!best || score < best.score) best = { cycle, score };
    }
    if (!best) continue;
    const key = `${best.cycle.cardAccountId}|${best.cycle.cycleDate}`;
    used.add(key);
    const diff = debit.chargedAmountAgorot - best.cycle.totalAgorot;
    out.push({
      bankTxnId: debit.id,
      cardAccountId: best.cycle.cardAccountId,
      cycleDate: best.cycle.cycleDate,
      expectedTotalAgorot: best.cycle.totalAgorot,
      diffAgorot: diff,
      status: diff === 0 ? 'matched' : 'partial',
    });
  }
  return out;
}
