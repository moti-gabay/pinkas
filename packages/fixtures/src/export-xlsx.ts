import ExcelJS from 'exceljs';
import { buildTable } from './export-csv.js';
import type { ExportLayout } from './export-csv.js';
import type { Household } from './types.js';

const AMOUNT_COLUMNS: Record<ExportLayout, readonly number[]> = { bank: [5, 6, 7], card: [4, 6] };

/** Statement workbook: 2 title rows, headers, rows, a סה"כ row. Amount cells are numeric. */
export async function toXlsx(
  h: Household,
  accountId: string,
  opts: { layout: ExportLayout },
): Promise<Uint8Array> {
  const table = buildTable(h, accountId, opts.layout);
  const amountCols = AMOUNT_COLUMNS[opts.layout];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('תנועות', { views: [{ rightToLeft: true }] });
  for (const line of table.title) sheet.addRow([line]).font = { bold: true, size: 14 };
  sheet.addRow([...table.headers]).font = { bold: true };
  const toCells = (cells: string[]): (string | number)[] =>
    cells.map((cell, i) =>
      amountCols.includes(i + 1) && cell !== '' ? Number(cell.replace(/,/g, '')) : cell,
    );
  for (const row of table.rows) sheet.addRow(toCells(row));
  sheet.addRow(toCells(table.total)).font = { bold: true };
  for (const col of amountCols) sheet.getColumn(col).numFmt = '#,##0.00';
  sheet.getColumn(3).width = 36;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
