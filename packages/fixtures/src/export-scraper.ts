import { TZ } from '@pinkas/domain';
import type { IsoDate } from '@pinkas/domain';
import { OPENING_BALANCE_AGOROT } from './export-csv.js';
import type { FixtureTxn, Household } from './types.js';

/** Mirrors israeli-bank-scrapers v6.12 `Transaction`; amounts are decimals, dates ISO at 00:00 Asia/Jerusalem. */
export interface ScraperTxn {
  type: 'normal' | 'installments';
  identifier?: string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  description: string;
  memo?: string;
  status: 'completed' | 'pending';
  installments?: { number: number; total: number };
}

export interface ScraperResult {
  success: true;
  accounts: { accountNumber: string; balance: number; txns: ScraperTxn[] }[];
}

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  timeZoneName: 'longOffset',
});

/** "GMT+03:00" → "+03:00" for the instant. */
function offsetAt(epochMs: number): string {
  const part =
    offsetFormatter.formatToParts(new Date(epochMs)).find((p) => p.type === 'timeZoneName')
      ?.value ?? 'GMT+02:00';
  return part.replace('GMT', '') || '+00:00';
}

/** Civil date → ISO datetime at local midnight with the Jerusalem offset in force at that moment. */
export function jerusalemMidnightIso(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Israel switches DST at 02:00 local, so the offset 12h before UTC midnight is the one at local midnight.
  return `${date}T00:00:00.000${offsetAt(utcMidnight - 12 * 3_600_000)}`;
}

function toScraperTxn(t: FixtureTxn): ScraperTxn {
  const txn: ScraperTxn = {
    type: t.installmentNumber === undefined ? 'normal' : 'installments',
    date: jerusalemMidnightIso(t.txnDate),
    processedDate: jerusalemMidnightIso(t.processedDate ?? t.txnDate),
    originalAmount: (t.originalAmountMinor ?? t.chargedAmountAgorot) / 100,
    originalCurrency: t.originalCurrency ?? 'ILS',
    chargedAmount: t.chargedAmountAgorot / 100,
    description: t.descriptionRaw,
    status: t.status,
  };
  if (t.externalIdentifier !== undefined) txn.identifier = t.externalIdentifier;
  if (t.memo !== undefined) txn.memo = t.memo;
  if (t.installmentNumber !== undefined && t.installmentTotal !== undefined) {
    txn.installments = { number: t.installmentNumber, total: t.installmentTotal };
  }
  return txn;
}

export function toScraperResult(h: Household, accountId: string): ScraperResult {
  const account = h.accounts.find((a) => a.id === accountId);
  if (!account) throw new RangeError(`unknown account ${accountId}`);
  const txns = h.transactions.filter((t) => t.accountId === accountId);
  const balanceAgorot =
    account.type === 'checking'
      ? txns.reduce((acc, t) => acc + t.chargedAmountAgorot, OPENING_BALANCE_AGOROT)
      : 0;
  return {
    success: true,
    accounts: [
      {
        accountNumber: account.externalId,
        balance: balanceAgorot / 100,
        txns: txns.map(toScraperTxn),
      },
    ],
  };
}
