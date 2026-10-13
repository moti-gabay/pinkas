/**
 * Single place for user-facing number/date formatting (Hebrew UI, ILS, DD/MM/YYYY).
 * Amounts are integer agorot everywhere; only this module turns them into text.
 */
const ilsFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ilsWholeFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});

export function formatAgorot(agorot: number, opts: { whole?: boolean } = {}): string {
  if (!Number.isSafeInteger(agorot))
    throw new RangeError(`formatAgorot: not a safe integer: ${agorot}`);
  const value = agorot / 100;
  return (opts.whole ? ilsWholeFormatter : ilsFormatter).format(value);
}

/** Formats an ISO civil date (YYYY-MM-DD) as DD/MM/YYYY. */
export function formatDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new RangeError(`formatDate: expected YYYY-MM-DD, got ${isoDate}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const hebrewMonths = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

/** "2026-03" → "מרץ 2026" */
export function formatMonth(isoMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(isoMonth);
  if (!m) throw new RangeError(`formatMonth: expected YYYY-MM, got ${isoMonth}`);
  const idx = Number(m[2]) - 1;
  const name = hebrewMonths[idx];
  if (name === undefined) throw new RangeError(`formatMonth: bad month ${isoMonth}`);
  return `${name} ${m[1]}`;
}

export function formatPercent(ratio: number, digits = 0): string {
  return new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: digits }).format(
    ratio,
  );
}
