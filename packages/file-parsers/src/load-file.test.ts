import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import { PinkasError } from '@pinkas/shared';
import { loadFile } from './load-file.js';
import { parseTable } from './parse-table.js';
import { genericAdapter, pickAdapter } from './adapters/generic.js';

const csv = [
  'תאריך,תיאור,סכום,אסמכתא,יתרה',
  '01/03/2026,סופר שופרסל,-150.50,1001,"5,000.00"',
  '02/03/2026,משכורת,"12,000.00",1002,"17,000.00"',
  '03/03/2026,קפה בוקר,-18.00,1003,"16,982.00"',
  '04/03/2026,ביט - העברה,-200.00,1004,"16,782.00"',
  '05/03/2026,החזר,35.25,1005,"16,817.25"',
  'סה"כ,,"11,666.75",,',
  '',
].join('\r\n');
const expectedAmounts = [-15050, 1200000, -1800, -20000, 3525];

async function loadAndParse(bytes: Uint8Array, filename: string) {
  const file = await loadFile(bytes, { filename });
  const adapter = pickAdapter(file);
  const tableResult = file.tables[0]!;
  const mapping = adapter.defaultMapping(tableResult);
  expect(mapping).toBeDefined();
  return { file, mapping: mapping!, result: parseTable(tableResult, mapping!) };
}

describe('loadFile + parseTable', () => {
  it('parses a UTF-8 CSV with a total row', async () => {
    const { file, mapping, result } = await loadAndParse(new TextEncoder().encode(csv), 'bank.csv');
    expect(file).toMatchObject({ format: 'csv', encoding: 'utf8' });
    expect(file.tables[0]!.name).toBe('bank');
    expect(mapping).toMatchObject({
      headerRowIndex: 0,
      date: 'תאריך',
      description: 'תיאור',
      amount: 'סכום',
      identifier: 'אסמכתא',
      balance: 'יתרה',
      amountSign: 'natural',
    });
    expect(result.rows.map((r) => r.chargedAmountAgorot)).toEqual(expectedAmounts);
    expect(result.rows.map((r) => r.txnDate)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ]);
    expect(result.rows[0]!.balanceAgorot).toBe(500000);
    expect(result.statementTotalAgorot).toBe(1166675);
    expect(result.closingBalanceAgorot).toBe(1681725);
    expect(result.skippedRows).toEqual([6]);
    expect(result.errors).toEqual([]);
  });

  it('parses the same CSV encoded as windows-1255', async () => {
    const { file, result } = await loadAndParse(iconv.encode(csv, 'windows-1255'), 'bank.csv');
    expect(file.encoding).toBe('windows-1255');
    expect(result.rows.map((r) => r.chargedAmountAgorot)).toEqual(expectedAmounts);
    expect(result.rows[0]!.descriptionRaw).toBe('סופר שופרסל');
    expect(result.statementTotalAgorot).toBe(1166675);
  });

  it('parses a semicolon CSV with debit/credit columns', async () => {
    const text = 'תאריך;פרטים;חובה;זכות\n01/03/2026;ארנונה;450.00;\n02/03/2026;משכורת;;12000.00\n';
    const { mapping, result } = await loadAndParse(new TextEncoder().encode(text), 'x.csv');
    expect(mapping).toMatchObject({ debit: 'חובה', credit: 'זכות', amountSign: 'natural' });
    expect(result.rows.map((r) => r.chargedAmountAgorot)).toEqual([-45000, 1200000]);
  });

  it('finds the header row below title rows', async () => {
    const text = 'דוח תנועות בחשבון\nחשבון: 123\n\nתאריך,תיאור,סכום\n01/03/2026,א,-1.00\n';
    const { mapping, result } = await loadAndParse(new TextEncoder().encode(text), 'x.csv');
    expect(mapping.headerRowIndex).toBe(3);
    expect(result.rows).toEqual([
      expect.objectContaining({ rowIndex: 4, chargedAmountAgorot: -100 }),
    ]);
  });

  it('parses an XLSX with merged title, empty row, serial and string dates and a summary row', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('תנועות');
    ws.addRow(['דוח כרטיס אשראי']);
    ws.mergeCells('A1:D1');
    ws.addRow(['תאריך עסקה', 'שם בית עסק', 'סכום חיוב', 'תאריך חיוב']);
    ws.addRow([46082, 'רמי לוי', 120.5, '10/03/2026']);
    ws.addRow([]);
    ws.addRow([
      new Date(Date.UTC(2026, 2, 2)),
      { richText: [{ text: 'ביט' }, { text: 'וח' }] },
      300,
      '10/03/2026',
    ]);
    ws.addRow(['סה"כ', null, { formula: 'SUM(C3:C5)', result: 420.5 }, null]);
    wb.addWorksheet('ריק');
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());

    const file = await loadFile(bytes, { filename: 'card.xlsx' });
    expect(file.format).toBe('xlsx');
    expect(file.tables.map((t) => t.name)).toEqual(['תנועות', 'ריק']);
    const t = file.tables[0]!;
    expect(t.rows[0]).toEqual(['דוח כרטיס אשראי', null, null, null]);
    expect(t.rows[3]).toEqual([]);
    expect(t.rows[4]![0]).toBe('2026-03-02');
    expect(t.rows[4]![1]).toBe('ביטוח');

    expect(pickAdapter(file)).toBe(genericAdapter);
    const mapping = genericAdapter.defaultMapping(t)!;
    expect(mapping).toMatchObject({
      headerRowIndex: 1,
      date: 'תאריך עסקה',
      processedDate: 'תאריך חיוב',
      description: 'שם בית עסק',
      amount: 'סכום חיוב',
      amountSign: 'invert',
    });
    const result = parseTable(t, mapping);
    expect(result.errors).toEqual([]);
    expect(
      result.rows.map((r) => [r.rowIndex, r.txnDate, r.processedDate, r.chargedAmountAgorot]),
    ).toEqual([
      [2, '2026-03-01', '2026-03-10', -12050],
      [4, '2026-03-02', '2026-03-10', -30000],
    ]);
    expect(result.skippedRows).toEqual([3, 5]);
    expect(result.statementTotalAgorot).toBe(-42050);
    expect(genericAdapter.defaultMapping(file.tables[1]!)).toBeUndefined();
  });

  it('rejects disguised HTML, executables, PDFs and delimiter-less text', async () => {
    const html = new TextEncoder().encode(
      '<html><body><table><tr><td>תאריך</td></tr></table></body></html>',
    );
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array<number>(64).fill(0)]);
    const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
    for (const [bytes, reason] of [
      [html, 'HTML content'],
      [exe, 'unsupported file type'],
      [pdf, 'PDF import is not implemented yet'],
      [new TextEncoder().encode('just text\nno columns\n'), 'no CSV delimiter found'],
    ] as const) {
      const err = await loadFile(bytes, { filename: 'statement.csv' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PinkasError);
      expect((err as PinkasError).code).toBe('UPLOAD_UNSUPPORTED');
      expect((err as PinkasError).message).toContain(reason);
    }
  });
});
