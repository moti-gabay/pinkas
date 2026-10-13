import { describe, expect, it } from 'vitest';
import { parseDate, parseTable } from './parse-table.js';
import type { ColumnMapping, RawTable } from './types.js';

const base: ColumnMapping = {
  headerRowIndex: 0,
  date: 'תאריך',
  description: 'תיאור',
  amount: 'סכום',
  amountSign: 'natural',
  dateFormat: 'auto',
};

function table(rows: RawTable['rows']): RawTable {
  return { name: 't', rows: [['תאריך', 'תיאור', 'סכום'], ...rows] };
}

describe('parseTable', () => {
  it('reads ambiguous 03/04/2026 as DMY by default and honours MDY/YMD', () => {
    const t = table([['03/04/2026', 'x', '-1.00']]);
    expect(parseTable(t, base).rows[0]!.txnDate).toBe('2026-04-03');
    expect(parseTable(t, { ...base, dateFormat: 'MDY' }).rows[0]!.txnDate).toBe('2026-03-04');
    const ymd = parseTable(table([['2026/04/03', 'x', '-1.00']]), { ...base, dateFormat: 'YMD' });
    expect(ymd.rows[0]!.txnDate).toBe('2026-04-03');
  });

  it('falls back to MDY under auto when DMY is impossible', () => {
    expect(parseDate('04/25/2026', 'auto')).toBe('2026-04-25');
    expect(parseDate('25/04/2026 14:30', 'auto')).toBe('2026-04-25');
    expect(parseDate(46082, 'auto')).toBe('2026-03-01');
    expect(parseDate('not a date', 'auto')).toBeUndefined();
  });

  it('strips bidi marks and NBSP but keeps the description otherwise verbatim', () => {
    const r = parseTable(table([['01/03/2026', '\u200f קפה ☕\u00a0בוקר \u200e', '-18.00']]), base);
    expect(r.rows[0]!.descriptionRaw).toBe('קפה ☕ בוקר');
    expect(r.rows[0]!.chargedAmountAgorot).toBe(-1800);
    expect(r.rows[0]!.raw).toEqual({ תאריך: '01/03/2026', תיאור: 'קפה ☕ בוקר', סכום: '-18.00' });
  });

  it('keeps two identical rows', () => {
    const r = parseTable(
      table([
        ['01/03/2026', 'x', '-5.00'],
        ['01/03/2026', 'x', '-5.00'],
      ]),
      base,
    );
    expect(r.rows.map((x) => [x.rowIndex, x.chargedAmountAgorot])).toEqual([
      [1, -500],
      [2, -500],
    ]);
  });

  it('inverts the sign when asked and computes credit minus debit', () => {
    const inv = parseTable(table([['01/03/2026', 'x', '120.50']]), {
      ...base,
      amountSign: 'invert',
    });
    expect(inv.rows[0]!.chargedAmountAgorot).toBe(-12050);
    const dc: RawTable = {
      name: 't',
      rows: [
        ['תאריך', 'תיאור', 'חובה', 'זכות'],
        ['01/03/2026', 'a', '450.00', ''],
        ['02/03/2026', 'b', '', '12,000.00'],
        ['03/03/2026', 'c', '', ''],
      ],
    };
    const { amount: _unused, ...rest } = base;
    const r = parseTable(dc, { ...rest, debit: 'חובה', credit: 'זכות' });
    expect(r.rows.map((x) => x.chargedAmountAgorot)).toEqual([-45000, 1200000]);
    expect(r.errors).toEqual([{ rowIndex: 3, message: 'empty amount' }]);
  });

  it('skips empty and total rows, records the statement total and closing balance', () => {
    const t: RawTable = {
      name: 't',
      rows: [
        ['תאריך', 'תיאור', 'סכום', 'יתרה'],
        ['01/03/2026', 'a', '-10.00', '990.00'],
        [],
        ['02/03/2026', 'b', '25.00', '1,015.00'],
        ['', 'סך הכל', '15.00', ''],
      ],
    };
    const r = parseTable(t, { ...base, balance: 'יתרה' });
    expect(r.rows).toHaveLength(2);
    expect(r.skippedRows).toEqual([2, 4]);
    expect(r.statementTotalAgorot).toBe(1500);
    expect(r.closingBalanceAgorot).toBe(101500);
    expect(r.errors).toEqual([]);
  });

  it('detects installments, pending status, original amount and identifier', () => {
    const t: RawTable = {
      name: 't',
      rows: [
        ['תאריך', 'תיאור', 'סכום', 'הערות', 'סטטוס', 'סכום מקורי', 'מטבע', 'אסמכתא'],
        ['01/03/2026', 'טלוויזיה תשלום 2 מתוך 12', '-100.00', '', '', '', '', '55'],
        ['02/03/2026', 'מזגן', '-200.00', '3/10 תשלומים', 'ממתין', '55.5', 'usd', ''],
        ['03/03/2026', 'ספר', '-30.00', 'pending', '', '', '', ''],
      ],
    };
    const r = parseTable(t, {
      ...base,
      memo: 'הערות',
      originalAmount: 'סכום מקורי',
      originalCurrency: 'מטבע',
      identifier: 'אסמכתא',
    });
    expect(r.rows.map((x) => [x.installmentNumber, x.installmentTotal, x.status])).toEqual([
      [2, 12, 'completed'],
      [3, 10, 'pending'],
      [undefined, undefined, 'pending'],
    ]);
    expect(r.rows[0]!.externalIdentifier).toBe('55');
    expect(r.rows[1]).toMatchObject({
      originalAmountMinor: 5550,
      originalCurrency: 'USD',
      memo: '3/10 תשלומים',
    });
  });

  it('collects per-row errors instead of throwing', () => {
    const r = parseTable(
      table([
        ['bogus', 'x', '-1.00'],
        ['01/03/2026', 'y', 'abc'],
        ['02/03/2026', 'z', '-2.00'],
      ]),
      base,
    );
    expect(r.rows.map((x) => x.rowIndex)).toEqual([3]);
    expect(r.errors.map((e) => e.rowIndex)).toEqual([1, 2]);
    expect(r.errors[0]!.message).toContain('invalid date');
  });

  it('reports unmapped columns at the header row', () => {
    const r = parseTable(table([]), { ...base, amount: 'nope' });
    expect(r.errors).toEqual([{ rowIndex: 0, message: 'column "nope" not found' }]);
  });
});
