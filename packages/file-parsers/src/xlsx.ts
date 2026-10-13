import ExcelJS from 'exceljs';
import type { Cell as XlsxCell, CellValue } from 'exceljs';
import type { Cell, RawTable } from './types.js';

/**
 * Every worksheet becomes a table. Fully empty rows are kept as `[]` so `rows[i]` is always sheet
 * row `i + 1`; the preview and error messages rely on that.
 */
export async function parseXlsx(buffer: Uint8Array): Promise<RawTable[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs types its argument as its own `Buffer extends ArrayBuffer`; the bytes go straight to
  // JSZip, which takes an ArrayBuffer, so a copy of the underlying buffer is the honest input.
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  return workbook.worksheets.map((sheet) => {
    const rows: Cell[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = toCell(cell);
      });
      // Holes left by eachCell (never-written columns) are undefined; normalise to null.
      for (let i = 0; i < cells.length; i += 1) cells[i] ??= null;
      rows[rowNumber - 1] = cells.every((c) => c === null) ? [] : cells;
    });
    for (let i = 0; i < rows.length; i += 1) rows[i] ??= [];
    return { name: sheet.name, rows };
  });
}

function toCell(cell: XlsxCell): Cell {
  // Merged ranges: only the master keeps its value, so a merged title does not look like data.
  if (cell.isMerged && cell.master.address !== cell.address) return null;
  return fromValue(cell.value);
}

function fromValue(value: CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date)
    return isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('hyperlink' in value) return value.text;
  if ('error' in value) return null;
  // Formula (plain or shared): we want what Excel last computed, never the expression.
  return value.result === undefined ? null : fromValue(value.result);
}
