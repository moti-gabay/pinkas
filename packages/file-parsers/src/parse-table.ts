import { assertIsoDate, parseDecimalToMinor, parseLooseDate } from '@pinkas/domain';
import type { Agorot, IsoDate } from '@pinkas/domain';
import { headerNames, isStatusHeader } from './headers.js';
import { cleanText, isEmptyCell, isEmptyRow } from './text.js';
import type { Cell, ColumnMapping, ParsedRow, ParseResult, RawTable } from './types.js';

const totalRe = /סה["״”']?כ|סך\s*הכל|סיכום|\btotal\b/i;
const pendingRe = /ממתין|pending/i;
const installmentRes = [/תשלום\s*(\d+)\s*מתוך\s*(\d+)/, /(\d+)\s*\/\s*(\d+)\s*תשלומים/];

export function parseTable(table: RawTable, mapping: ColumnMapping): ParseResult {
  const result: ParseResult = {
    headers: [],
    rows: [],
    errors: [],
    skippedRows: [],
    statementTotalAgorot: undefined,
    closingBalanceAgorot: undefined,
  };
  const headerRow = table.rows[mapping.headerRowIndex];
  if (!headerRow) {
    result.errors.push({ rowIndex: mapping.headerRowIndex, message: 'header row is out of range' });
    return result;
  }
  result.headers = headerNames(headerRow);

  const col = (name: string | undefined): number | undefined => {
    if (name === undefined) return undefined;
    const i = result.headers.indexOf(name);
    if (i === -1) {
      result.errors.push({
        rowIndex: mapping.headerRowIndex,
        message: `column "${name}" not found`,
      });
      return undefined;
    }
    return i;
  };
  const cols = {
    date: col(mapping.date),
    processedDate: col(mapping.processedDate),
    amount: col(mapping.amount),
    debit: col(mapping.debit),
    credit: col(mapping.credit),
    description: col(mapping.description),
    memo: col(mapping.memo),
    identifier: col(mapping.identifier),
    originalAmount: col(mapping.originalAmount),
    originalCurrency: col(mapping.originalCurrency),
    balance: col(mapping.balance),
    status: result.headers.findIndex(isStatusHeader),
  };
  if (!mapping.amount && !mapping.debit && !mapping.credit) {
    result.errors.push({ rowIndex: mapping.headerRowIndex, message: 'no amount column mapped' });
  }
  if (result.errors.length > 0 || cols.date === undefined || cols.description === undefined) {
    return result;
  }

  const at = (row: Cell[], i: number | undefined): Cell | undefined =>
    i === undefined ? undefined : row[i];
  /** The cell when it holds something, else undefined; lets callers skip empty-cell casts. */
  const value = (row: Cell[], i: number | undefined): string | number | undefined => {
    const c = at(row, i);
    return c === undefined || c === null || cleanText(c) === '' ? undefined : c;
  };
  const text = (row: Cell[], i: number | undefined): string | undefined => {
    const c = value(row, i);
    return c === undefined ? undefined : cleanText(c);
  };

  const readAmount = (row: Cell[]): Agorot => {
    if (cols.amount !== undefined) {
      const c = value(row, cols.amount);
      if (c === undefined) throw new RangeError('empty amount');
      const v = parseDecimalToMinor(c);
      return mapping.amountSign === 'invert' ? -v : v;
    }
    const debit = value(row, cols.debit);
    const credit = value(row, cols.credit);
    if (debit === undefined && credit === undefined) throw new RangeError('empty amount');
    return (
      (credit === undefined ? 0 : parseDecimalToMinor(credit)) -
      (debit === undefined ? 0 : parseDecimalToMinor(debit))
    );
  };
  const tryAmount = (row: Cell[]): Agorot | undefined => {
    try {
      return readAmount(row);
    } catch {
      return undefined;
    }
  };

  for (let i = mapping.headerRowIndex + 1; i < table.rows.length; i += 1) {
    const row = table.rows[i] ?? [];
    if (isEmptyRow(row)) {
      result.skippedRows.push(i);
      continue;
    }
    const firstCell = row.find((c) => !isEmptyCell(c));
    const description = text(row, cols.description) ?? '';
    const date = parseDate(at(row, cols.date), mapping.dateFormat);
    // Summary rows: an explicit total label, or a date-less row whose only content is an amount
    // plus a total-like description.
    const labelledTotal = totalRe.test(cleanText(firstCell ?? null));
    const implicitTotal =
      date === undefined && totalRe.test(description) && tryAmount(row) !== undefined;
    if (labelledTotal || implicitTotal) {
      result.skippedRows.push(i);
      const total = tryAmount(row);
      if (total !== undefined) result.statementTotalAgorot = total;
      continue;
    }

    try {
      result.rows.push(parseRow(row, i, date, description));
    } catch (err) {
      result.errors.push({
        rowIndex: i,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;

  function parseRow(
    row: Cell[],
    rowIndex: number,
    date: IsoDate | undefined,
    description: string,
  ): ParsedRow {
    if (date === undefined)
      throw new RangeError(`invalid date: "${cleanText(at(row, cols.date) ?? null)}"`);
    const chargedAmountAgorot = readAmount(row);
    const processedCell = value(row, cols.processedDate);
    const processedDate =
      processedCell === undefined ? undefined : parseDate(processedCell, mapping.dateFormat);
    if (processedCell !== undefined && processedDate === undefined) {
      throw new RangeError(`invalid processed date: "${cleanText(processedCell)}"`);
    }
    const memo = text(row, cols.memo);
    const originalCurrency = text(row, cols.originalCurrency)?.toUpperCase();
    const originalCell = value(row, cols.originalAmount);
    const originalAmountMinor =
      originalCell === undefined
        ? undefined
        : parseDecimalToMinor(originalCell, originalCurrency ?? 'ILS');
    const balanceCell = value(row, cols.balance);
    const balanceAgorot = balanceCell === undefined ? undefined : tryMinor(balanceCell);
    if (balanceAgorot !== undefined) result.closingBalanceAgorot = balanceAgorot;
    const installments = findInstallments(`${description} ${memo ?? ''}`);
    const statusText = `${text(row, cols.status === -1 ? undefined : cols.status) ?? ''} ${memo ?? ''}`;

    const raw: Record<string, string> = {};
    result.headers.forEach((h, c) => {
      raw[h] = cleanText(row[c] ?? null);
    });

    return {
      rowIndex,
      txnDate: date,
      processedDate,
      chargedAmountAgorot,
      originalAmountMinor,
      originalCurrency,
      descriptionRaw: description,
      memo,
      externalIdentifier: text(row, cols.identifier),
      status: pendingRe.test(statusText) ? 'pending' : 'completed',
      installmentNumber: installments?.[0],
      installmentTotal: installments?.[1],
      balanceAgorot,
      raw,
    };
  }
}

function tryMinor(cell: string | number): Agorot | undefined {
  try {
    return parseDecimalToMinor(cell);
  } catch {
    return undefined;
  }
}

function findInstallments(s: string): [number, number] | undefined {
  for (const re of installmentRes) {
    const m = re.exec(s);
    if (m) return [Number(m[1]), Number(m[2])];
  }
  return undefined;
}

const numericDateRe = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})(?:[T ].*)?$/;

/** 'auto' tries DMY before MDY: Israeli exports are day-first, so 03/04 is 3 April. */
export function parseDate(
  cell: Cell | undefined,
  format: ColumnMapping['dateFormat'],
): IsoDate | undefined {
  if (cell === undefined || cell === null) return undefined;
  if (typeof cell === 'number') return parseLooseDate(cell);
  const s = cleanText(cell);
  const m = numericDateRe.exec(s);
  if (!m) return parseLooseDate(s);
  const [, a, b, c] = m as unknown as [string, string, string, string];
  switch (format) {
    case 'YMD':
      return toIso(a, b, c);
    case 'MDY':
      return toIso(c, a, b);
    case 'DMY':
      return toIso(c, b, a);
    case 'auto':
      if (a.length === 4) return toIso(a, b, c);
      return toIso(c, b, a) ?? toIso(c, a, b);
  }
}

function toIso(y: string, m: string, d: string): IsoDate | undefined {
  if (y.length !== 2 && y.length !== 4) return undefined;
  const year = y.length === 2 ? `20${y}` : y;
  try {
    return assertIsoDate(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  } catch {
    return undefined;
  }
}
