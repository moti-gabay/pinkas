/**
 * Money is always an integer amount of minor units (agorot for ILS). This module is the only
 * place that converts between decimal strings and integers. No floats enter arithmetic.
 */
export type Agorot = number;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function assertAgorot(value: number, label = 'amount'): Agorot {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} must be a safe integer of agorot, got ${value}`);
  return value;
}

/** ISO-4217 minor unit exponents for currencies that differ from 2. */
const minorUnitExponent: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  HUF: 2,
  KWD: 3,
  BHD: 3,
  JOD: 3,
  TND: 3,
};

export function exponentFor(currency: string): number {
  return minorUnitExponent[currency.toUpperCase()] ?? 2;
}

/**
 * Parses a decimal string such as "1,234.56", "-1 234,56", "₪ 12.5", "(12.50)" into integer minor units.
 * Handles thousands separators, a trailing/leading minus, parentheses negatives and Hebrew/RTL marks.
 */
export function parseDecimalToMinor(input: string | number, currency = 'ILS'): Agorot {
  const exp = exponentFor(currency);
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError(`not a finite number: ${input}`);
    // Numbers from XLSX cells: round to the currency's precision via string to avoid 0.1+0.2 issues.
    return parseDecimalToMinor(input.toFixed(exp), currency);
  }
  let s = input
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\s\u00a0₪$€£]/g, '')
    .replace(/ILS|NIS|USD|EUR/gi, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s === '') throw new RangeError(`empty amount: "${input}"`);

  // Decide the decimal separator: the last of '.' or ',' if it is followed by 1-3 digits and the other char appears as grouping.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart: string;
  let fracPart = '';
  const sepIdx = Math.max(lastDot, lastComma);
  if (sepIdx === -1) {
    intPart = s;
  } else {
    const after = s.slice(sepIdx + 1);
    const before = s.slice(0, sepIdx);
    const sepChar = s[sepIdx];
    const otherChar = sepChar === '.' ? ',' : '.';
    const looksLikeGrouping =
      after.length === 3 &&
      !before.includes(otherChar) &&
      (sepChar === ',' || before.includes(','));
    if (looksLikeGrouping) {
      intPart = before + after;
    } else {
      intPart = before;
      fracPart = after;
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart))
    throw new RangeError(`not a decimal amount: "${input}"`);
  if (fracPart.length > exp) {
    // Extra precision beyond the currency's minor unit: must be zeros (e.g. "12.500" for ILS).
    if (/[1-9]/.test(fracPart.slice(exp)))
      throw new RangeError(`too many decimals for ${currency}: "${input}"`);
    fracPart = fracPart.slice(0, exp);
  }
  const minor = Number(intPart || '0') * 10 ** exp + Number(fracPart.padEnd(exp, '0') || '0');
  if (minor > MAX_SAFE) throw new RangeError(`amount too large: "${input}"`);
  return negative ? -minor : minor;
}

export function sum(values: Iterable<Agorot>): Agorot {
  let total = 0;
  for (const v of values) total = assertAgorot(total + assertAgorot(v));
  return total;
}

/** Integer percentage with banker's-free rounding (half away from zero), for budgets/reserves. */
export function percentOf(amount: Agorot, pct: number): Agorot {
  assertAgorot(amount);
  const scaled = amount * pct;
  const rounded = scaled < 0 ? -Math.round(-scaled / 100) : Math.round(scaled / 100);
  return assertAgorot(rounded);
}

export function abs(amount: Agorot): Agorot {
  return Math.abs(assertAgorot(amount));
}
