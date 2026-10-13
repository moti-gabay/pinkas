import { formatDate } from '@pinkas/shared';
import iconv from 'iconv-lite';
import type { FixtureAccount, FixtureTxn, Household } from './types.js';

export type ExportLayout = 'bank' | 'card';

export interface CsvOptions {
  layout: ExportLayout;
  encoding: 'utf8' | 'windows-1255';
  withTotalRow?: boolean;
}

export const BANK_HEADERS = [
  'תאריך',
  'תאריך ערך',
  'תיאור',
  'אסמכתא',
  'חובה',
  'זכות',
  'יתרה',
] as const;
export const CARD_HEADERS = [
  'תאריך עסקה',
  'תאריך חיוב',
  'שם בית עסק',
  'סכום עסקה',
  'מטבע',
  'סכום חיוב',
  'פרטים',
] as const;
export const TOTAL_LABEL = 'סה"כ';
export const OPENING_BALANCE_AGOROT = 2_500_000;

/** Integer agorot → "1,234.56" / "-1,234.56" without touching floats. */
export function formatAmount(agorot: number): string {
  const magnitude = Math.abs(agorot);
  const whole = String(Math.trunc(magnitude / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(magnitude % 100).padStart(2, '0');
  return `${agorot < 0 ? '-' : ''}${whole}.${frac}`;
}

export function installmentMemo(t: FixtureTxn): string {
  if (t.memo !== undefined) return t.memo;
  if (t.installmentNumber !== undefined && t.installmentTotal !== undefined)
    return `תשלום ${t.installmentNumber} מתוך ${t.installmentTotal}`;
  return '';
}

export interface Table {
  title: string[];
  headers: readonly string[];
  rows: string[][];
  total: string[];
}

export function accountTxns(
  h: Household,
  accountId: string,
): { account: FixtureAccount; txns: FixtureTxn[] } {
  const account = h.accounts.find((a) => a.id === accountId);
  if (!account) throw new RangeError(`unknown account ${accountId}`);
  return { account, txns: h.transactions.filter((t) => t.accountId === accountId) };
}

/** Rows as a bank or card statement shows them; shared by the CSV and XLSX exporters. */
export function buildTable(h: Household, accountId: string, layout: ExportLayout): Table {
  const { account, txns } = accountTxns(h, accountId);
  const first = txns[0]?.txnDate;
  const last = txns.at(-1)?.txnDate;
  const period =
    first !== undefined && last !== undefined
      ? `לתקופה ${formatDate(first)} - ${formatDate(last)}`
      : 'לתקופה';
  if (layout === 'bank') {
    let balance = OPENING_BALANCE_AGOROT;
    let debit = 0;
    let credit = 0;
    const rows = txns.map((t) => {
      balance += t.chargedAmountAgorot;
      if (t.chargedAmountAgorot < 0) debit -= t.chargedAmountAgorot;
      else credit += t.chargedAmountAgorot;
      return [
        formatDate(t.txnDate),
        formatDate(t.processedDate ?? t.txnDate),
        t.descriptionRaw,
        t.externalIdentifier ?? '',
        t.chargedAmountAgorot < 0 ? formatAmount(-t.chargedAmountAgorot) : '',
        t.chargedAmountAgorot > 0 ? formatAmount(t.chargedAmountAgorot) : '',
        formatAmount(balance),
      ];
    });
    return {
      title: [`פירוט תנועות בחשבון ${account.externalId}`, period],
      headers: BANK_HEADERS,
      rows,
      total: [
        TOTAL_LABEL,
        '',
        '',
        '',
        formatAmount(debit),
        formatAmount(credit),
        formatAmount(balance),
      ],
    };
  }
  // Card statements show charges as positive numbers and refunds as negatives.
  let charged = 0;
  const rows = txns.map((t) => {
    charged -= t.chargedAmountAgorot;
    return [
      formatDate(t.txnDate),
      formatDate(t.processedDate ?? t.txnDate),
      t.descriptionRaw,
      formatAmount(-(t.originalAmountMinor ?? t.chargedAmountAgorot)),
      t.originalCurrency ?? 'ILS',
      formatAmount(-t.chargedAmountAgorot),
      installmentMemo(t),
    ];
  });
  return {
    title: [`פירוט עסקאות לכרטיס ${account.externalId}`, period],
    headers: CARD_HEADERS,
    rows,
    total: [TOTAL_LABEL, '', '', '', '', formatAmount(charged), ''],
  };
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(h: Household, accountId: string, opts: CsvOptions): Uint8Array {
  const table = buildTable(h, accountId, opts.layout);
  const lines = [table.headers, ...table.rows, ...(opts.withTotalRow ? [table.total] : [])];
  const text = lines.map((cells) => cells.map(csvField).join(',')).join('\r\n') + '\r\n';
  if (opts.encoding === 'windows-1255') {
    const buf = iconv.encode(text, 'windows-1255');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new TextEncoder().encode(`\uFEFF${text}`);
}
