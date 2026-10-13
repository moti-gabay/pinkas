import { describe, expect, it } from 'vitest';
import { detectHeaderRow, headerNames, suggestMapping } from './headers.js';
import type { RawTable } from './types.js';

describe('detectHeaderRow', () => {
  it('skips title rows and finds the row with a date and an amount header', () => {
    const table: RawTable = {
      name: 't',
      rows: [
        ['דוח תנועות בחשבון'],
        [],
        ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
        ['01/03/2026', 'x', '1', '', '2'],
      ],
    };
    expect(detectHeaderRow(table)).toBe(2);
  });

  it('returns undefined when no row looks like headers', () => {
    expect(
      detectHeaderRow({
        name: 't',
        rows: [
          ['a', 'b'],
          ['1', '2'],
        ],
      }),
    ).toBeUndefined();
  });
});

describe('suggestMapping', () => {
  it('maps Hebrew bank headers incl. debit/credit and does not invert', () => {
    const table: RawTable = {
      name: 't',
      rows: [
        ['תאריך', 'תאריך ערך', 'פרטים', 'אסמכתא', 'חובה', 'זכות', 'יתרה'],
        ['01/03/2026', '01/03/2026', 'x', '7', '100', '', '900'],
      ],
    };
    expect(suggestMapping(table, 0)).toEqual({
      headerRowIndex: 0,
      date: 'תאריך',
      processedDate: 'תאריך ערך',
      description: 'פרטים',
      identifier: 'אסמכתא',
      debit: 'חובה',
      credit: 'זכות',
      balance: 'יתרה',
      amountSign: 'natural',
      dateFormat: 'auto',
    });
  });

  it('maps card headers, falls back to סכום עסקה as the amount and inverts all-positive amounts', () => {
    const table: RawTable = {
      name: 't',
      rows: [
        ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'מטבע', 'תאריך חיוב', 'הערות'],
        ['01/03/2026', 'x', '120.50', 'ILS', '10/03/2026', ''],
        ['02/03/2026', 'y', '30', 'ILS', '10/03/2026', ''],
      ],
    };
    expect(suggestMapping(table, 0)).toEqual({
      headerRowIndex: 0,
      date: 'תאריך עסקה',
      processedDate: 'תאריך חיוב',
      description: 'שם בית עסק',
      amount: 'סכום עסקה',
      originalCurrency: 'מטבע',
      memo: 'הערות',
      amountSign: 'invert',
      dateFormat: 'auto',
    });
  });

  it('maps English headers', () => {
    const table: RawTable = {
      name: 't',
      rows: [
        ['Date', 'Description', 'Amount', 'Reference', 'Balance'],
        ['2026-03-01', 'x', '-5', '1', '2'],
      ],
    };
    const m = suggestMapping(table, 0);
    expect(m).toMatchObject({
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
      identifier: 'Reference',
      balance: 'Balance',
      amountSign: 'natural',
    });
  });

  it('returns undefined without a date, description and amount', () => {
    expect(
      suggestMapping(
        {
          name: 't',
          rows: [
            ['תאריך', 'סכום'],
            ['01/03/2026', '1'],
          ],
        },
        0,
      ),
    ).toBeUndefined();
  });
});

describe('headerNames', () => {
  it('cleans, names empty headers and de-duplicates', () => {
    expect(headerNames(['\u200fתאריך ', null, 'סכום', 'סכום'])).toEqual([
      'תאריך',
      'column 2',
      'סכום',
      'סכום (2)',
    ]);
  });
});
