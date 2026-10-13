import { addMonths, monthOf } from './dates.js';
import type { NormalizedTxn } from './types.js';

/**
 * Installments are counted per charged installment (ADR 0003). The group key ties the rows of one
 * purchase together: account + frozen-ish merchant + total count + first charge month.
 */
export function installmentGroupKey(
  t: NormalizedTxn,
  merchantNormalized: string,
): string | undefined {
  if (t.installmentNumber === undefined || t.installmentTotal === undefined) return undefined;
  const firstMonth = addMonths(monthOf(t.txnDate), -(t.installmentNumber - 1));
  return [t.accountId, merchantNormalized, String(t.installmentTotal), firstMonth].join('|');
}

const installmentRe =
  /(?:תשלום|תש')\s*(\d{1,2})\s*(?:מתוך|\/|מ-)\s*(\d{1,2})|(\d{1,2})\s*\/\s*(\d{1,2})\s*תשלומים|קרדיט\s*(\d{1,2})\s*\/\s*(\d{1,2})/u;

/** Extracts "תשלום 3 מתוך 12" style installment info from free text (cards that omit the structured field). */
export function parseInstallmentText(
  text: string | undefined,
): { number: number; total: number } | undefined {
  if (!text) return undefined;
  const m = installmentRe.exec(text);
  if (!m) return undefined;
  const number = Number(m[1] ?? m[3] ?? m[5]);
  const total = Number(m[2] ?? m[4] ?? m[6]);
  if (
    !Number.isInteger(number) ||
    !Number.isInteger(total) ||
    number < 1 ||
    total < 2 ||
    number > total
  )
    return undefined;
  return { number, total };
}
