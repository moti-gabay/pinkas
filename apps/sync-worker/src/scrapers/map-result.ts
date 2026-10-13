/**
 * Converts an israeli-bank-scrapers result into our NormalizedTxn rows. Pure (no I/O) so it can be
 * contract-tested against recorded/synthetic results. Amounts become integer minor units; ISO timestamps
 * become civil dates in Asia/Jerusalem. Account numbers are kept only to look up/create accounts.
 */
import {
  exponentFor,
  instantToIsoDate,
  parseInstallmentText,
  type NormalizedTxn,
} from '@pinkas/domain';
import type { ScraperScrapingResult } from 'israeli-bank-scrapers';

// The library does not re-export its transaction types from the package root; derive them from the result type.
type TransactionsAccount = NonNullable<ScraperScrapingResult['accounts']>[number];
type Transaction = TransactionsAccount['txns'][number];

export interface MappedAccount {
  accountNumber: string;
  balanceAgorot: number | undefined;
  balanceDate: string | undefined;
  rows: Omit<NormalizedTxn, 'accountId'>[];
}

export function toMinor(amount: number, currency: string): number {
  const exp = exponentFor(currency);
  return Math.round(amount * 10 ** exp);
}

function mapTxn(t: Transaction): Omit<NormalizedTxn, 'accountId'> {
  const chargedCurrency = t.chargedCurrency ?? 'ILS';
  const original =
    t.originalCurrency && t.originalCurrency !== chargedCurrency
      ? { minor: toMinor(t.originalAmount, t.originalCurrency), currency: t.originalCurrency }
      : undefined;
  const installments =
    t.installments ?? parseInstallmentText(t.memo) ?? parseInstallmentText(t.description);
  return {
    origin: 'scraper',
    externalIdentifier: t.identifier === undefined ? undefined : String(t.identifier),
    txnDate: instantToIsoDate(t.date),
    processedDate: t.processedDate ? instantToIsoDate(t.processedDate) : undefined,
    chargedAmountAgorot: toMinor(t.chargedAmount, chargedCurrency),
    originalAmountMinor: original?.minor,
    originalCurrency: original?.currency,
    status: (t.status as string) === 'pending' ? 'pending' : 'completed',
    descriptionRaw: t.description,
    memo: t.memo?.trim() ? t.memo.trim() : undefined,
    installmentNumber: installments?.number,
    installmentTotal: installments?.total,
  };
}

export function mapAccount(a: TransactionsAccount): MappedAccount {
  return {
    accountNumber: a.accountNumber,
    balanceAgorot: a.balance === undefined ? undefined : toMinor(a.balance, a.currency ?? 'ILS'),
    balanceDate: a.balanceDate,
    rows: a.txns.map(mapTxn),
  };
}

export function mapResult(result: ScraperScrapingResult): MappedAccount[] {
  if (!result.success || !result.accounts) return [];
  return result.accounts.map(mapAccount);
}
