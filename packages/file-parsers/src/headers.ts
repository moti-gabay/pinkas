import { parseDecimalToMinor } from '@pinkas/domain';
import { cleanText, isEmptyRow } from './text.js';
import type { Cell, ColumnMapping, RawTable } from './types.js';

type Field =
  | 'date'
  | 'processedDate'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'description'
  | 'memo'
  | 'identifier'
  | 'originalAmount'
  | 'originalCurrency'
  | 'balance'
  | 'status';

/** Exact matches on the normalised header text. Order within a field does not matter. */
const exact: Record<Field, string[]> = {
  date: [
    'תאריך',
    'תאריך עסקה',
    'תאריך העסקה',
    'תאריך רכישה',
    'תאריך פעולה',
    'תאריך ביצוע',
    'date',
    'transaction date',
    'txn date',
  ],
  processedDate: [
    'תאריך חיוב',
    'תאריך ערך',
    'מועד חיוב',
    'תאריך קניה',
    'processed date',
    'charge date',
    'value date',
    'posting date',
  ],
  amount: [
    'סכום',
    'סכום חיוב',
    'סכום לחיוב',
    'סכום החיוב',
    'סכום בשח',
    'סכום בשקלים',
    'amount',
    'charged amount',
    'sum',
  ],
  debit: ['חובה', 'חיוב', 'debit', 'withdrawal'],
  credit: ['זכות', 'זיכוי', 'credit', 'deposit'],
  description: [
    'תיאור',
    'פרטים',
    'שם בית עסק',
    'שם בית העסק',
    'בית עסק',
    'תיאור פעולה',
    'תיאור העסקה',
    'תיאור עסקה',
    'שם העסק',
    'description',
    'merchant',
    'details',
    'payee',
    'narrative',
  ],
  memo: ['הערות', 'הערה', 'פירוט נוסף', 'memo', 'notes', 'note', 'comment', 'comments'],
  identifier: [
    'אסמכתא',
    'מספר אסמכתא',
    'מס אסמכתא',
    'מספר שובר',
    'reference',
    'ref',
    'transaction id',
    'id',
  ],
  originalAmount: [
    'סכום מקורי',
    'סכום עסקה',
    'סכום העסקה',
    'סכום עסקה מקורי',
    'original amount',
    'transaction amount',
  ],
  originalCurrency: [
    'מטבע',
    'מטבע מקור',
    'מטבע עסקה',
    'מטבע מקורי',
    'currency',
    'original currency',
  ],
  balance: ['יתרה', 'יתרה לאחר פעולה', 'יתרה בשח', 'balance', 'running balance'],
  status: ['סטטוס', 'מצב', 'status'],
};

/** Looser rules for headers the dictionary missed (e.g. 'תאריך רכישה בבית העסק'). */
const fuzzy: [Field, RegExp][] = [
  ['processedDate', /^(תאריך|מועד) (חיוב|ערך)|charge|posting|value date/],
  ['date', /^תאריך|date/],
  ['debit', /^חובה|debit/],
  ['credit', /^זכות|credit/],
  ['balance', /^יתרה|balance/],
  ['originalCurrency', /^מטבע|currency/],
  ['originalAmount', /מקורי|original/],
  ['amount', /^סכום|amount/],
  ['description', /תיאור|בית עסק|פרטים|description|merchant/],
  ['identifier', /אסמכתא|reference/],
  ['memo', /הער|memo|note/],
  ['status', /סטטוס|status/],
];

function normalise(header: string): string {
  return cleanText(header)
    .toLowerCase()
    .replace(/["'״׳.:()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const exactLookup = new Map<string, Field>();
for (const [field, names] of Object.entries(exact) as [Field, string[]][]) {
  for (const n of names) exactLookup.set(normalise(n), field);
}

export function fieldForHeader(header: string): Field | undefined {
  const key = normalise(header);
  if (key === '') return undefined;
  const hit = exactLookup.get(key);
  if (hit) return hit;
  return fuzzy.find(([, re]) => re.test(key))?.[0];
}

export function isStatusHeader(header: string): boolean {
  return fieldForHeader(header) === 'status';
}

/** Header names made unique and non-empty, so mapping-by-name and `raw` records are unambiguous. */
export function headerNames(row: Cell[]): string[] {
  const seen = new Map<string, number>();
  return row.map((cell, i) => {
    const base = cleanText(cell) || `column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

const HEADER_SCAN_ROWS = 15;

/** The first of the top rows with the most dictionary hits; needs a date and some amount column. */
export function detectHeaderRow(table: RawTable): number | undefined {
  let best: { index: number; score: number } | undefined;
  const limit = Math.min(table.rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i += 1) {
    const row = table.rows[i];
    if (!row || isEmptyRow(row)) continue;
    const fields = new Set<Field>();
    for (const cell of row) {
      const f = typeof cell === 'string' ? fieldForHeader(cell) : undefined;
      if (f) fields.add(f);
    }
    const hasAmount = fields.has('amount') || fields.has('debit') || fields.has('credit');
    if (!fields.has('date') || !hasAmount) continue;
    if (!best || fields.size > best.score) best = { index: i, score: fields.size };
  }
  return best?.index;
}

const optionalFields = [
  'processedDate',
  'amount',
  'debit',
  'credit',
  'memo',
  'identifier',
  'originalAmount',
  'originalCurrency',
  'balance',
] as const;

export function suggestMapping(table: RawTable, headerRowIndex: number): ColumnMapping | undefined {
  const row = table.rows[headerRowIndex];
  if (!row) return undefined;
  const headers = headerNames(row);
  const byField = new Map<Field, string>();
  // Exact matches first so 'תאריך חיוב' does not steal 'date' from 'תאריך' by column order.
  for (const pass of ['exact', 'fuzzy'] as const) {
    headers.forEach((h, i) => {
      const cell = row[i];
      if (typeof cell !== 'string') return;
      const field = pass === 'exact' ? exactLookup.get(normalise(cell)) : fieldForHeader(cell);
      if (field && !byField.has(field)) byField.set(field, h);
    });
  }
  // Card exports often carry only 'סכום עסקה': use it as the charged amount rather than nothing.
  if (!byField.has('amount') && !byField.has('debit') && !byField.has('credit')) {
    const orig = byField.get('originalAmount');
    if (orig) {
      byField.set('amount', orig);
      byField.delete('originalAmount');
    }
  }
  const date = byField.get('date');
  const description = byField.get('description');
  const hasAmount = byField.has('amount') || byField.has('debit') || byField.has('credit');
  if (!date || !description || !hasAmount) return undefined;

  const mapping: ColumnMapping = {
    headerRowIndex,
    date,
    description,
    amountSign: 'natural',
    dateFormat: 'auto',
  };
  for (const f of optionalFields) {
    const h = byField.get(f);
    if (h) mapping[f] = h;
  }
  if (mapping.amount && allPositive(table, headerRowIndex, headers.indexOf(mapping.amount))) {
    mapping.amountSign = 'invert';
  }
  return mapping;
}

/**
 * A single amount column that is never negative is almost certainly a card statement that lists
 * expenses as positive numbers; the user can still flip it in the mapping step.
 */
function allPositive(table: RawTable, headerRowIndex: number, col: number): boolean {
  let seen = 0;
  for (const row of table.rows.slice(headerRowIndex + 1, headerRowIndex + 51)) {
    const cell = row[col];
    if (cell === undefined || cell === null || cleanText(cell) === '') continue;
    try {
      const v = parseDecimalToMinor(cell);
      if (v < 0) return false;
      if (v > 0) seen += 1;
    } catch {
      // Not a number (e.g. a total label); ignore.
    }
  }
  return seen > 0;
}
