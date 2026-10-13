import { Temporal } from 'temporal-polyfill';

/**
 * All transaction dates are civil dates (YYYY-MM-DD) in Asia/Jerusalem. Scraper timestamps are
 * converted here, once, before anything else sees them. Month math uses Temporal, never Date.
 */
export const TZ = 'Asia/Jerusalem';

export type IsoDate = string; // YYYY-MM-DD
export type IsoMonth = string; // YYYY-MM

const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
const isoMonthRe = /^\d{4}-\d{2}$/;

export function assertIsoDate(s: string): IsoDate {
  if (!isoDateRe.test(s)) throw new RangeError(`not an ISO date: ${s}`);
  Temporal.PlainDate.from(s); // throws on 2026-02-30
  return s;
}

export function assertIsoMonth(s: string): IsoMonth {
  if (!isoMonthRe.test(s)) throw new RangeError(`not an ISO month: ${s}`);
  Temporal.PlainYearMonth.from(s);
  return s;
}

/** ISO timestamp (any offset / Z) → civil date in Asia/Jerusalem. */
export function instantToIsoDate(iso: string): IsoDate {
  const instant = Temporal.Instant.from(iso);
  return instant.toZonedDateTimeISO(TZ).toPlainDate().toString();
}

/** "2026-03-07T00:00:00.000Z"-style strings the scraper emits for civil dates are treated via Jerusalem too. */
export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function monthRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  const ym = Temporal.PlainYearMonth.from(month);
  return {
    from: ym.toPlainDate({ day: 1 }).toString(),
    to: ym.toPlainDate({ day: ym.daysInMonth }).toString(),
  };
}

export function addMonths(month: IsoMonth, n: number): IsoMonth {
  return Temporal.PlainYearMonth.from(month).add({ months: n }).toString();
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return Temporal.PlainDate.from(date).add({ days: n }).toString();
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: 'day' }).days;
}

export function daysInMonth(month: IsoMonth): number {
  return Temporal.PlainYearMonth.from(month).daysInMonth;
}

export function dayOfMonth(date: IsoDate): number {
  return Temporal.PlainDate.from(date).day;
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return Temporal.PlainDate.compare(a, b);
}

/** Today's civil date in Asia/Jerusalem (injectable for tests). */
export function todayInJerusalem(now: () => string = () => new Date().toISOString()): IsoDate {
  return instantToIsoDate(now());
}

/** Parses DD/MM/YYYY, DD.MM.YYYY, DD-MM-YY, YYYY-MM-DD and Excel serial numbers into an ISO date. */
export function parseLooseDate(input: string | number): IsoDate | undefined {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 20000 || input > 80000) return undefined;
    // Excel serial (1900 system). 25569 = 1970-01-01.
    const epochDays = Math.floor(input) - 25569;
    return Temporal.PlainDate.from('1970-01-01').add({ days: epochDays }).toString();
  }
  const s = input.trim().replace(/[\u200e\u200f]/g, '');
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) return safeDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3] ?? '';
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return safeDate(year, Number(m[2]), Number(m[1]));
  }
  return undefined;
}

function safeDate(y: number, mo: number, d: number): IsoDate | undefined {
  try {
    return Temporal.PlainDate.from(
      { year: y, month: mo, day: d },
      { overflow: 'reject' },
    ).toString();
  } catch {
    return undefined;
  }
}
