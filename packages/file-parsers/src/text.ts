import type { Cell } from './types.js';

// Bidi controls (LRM/RLM, embeddings, isolates) and the BOM: invisible, but they break
// equality checks on headers and pollute descriptions. NBSP is a plain space for our purposes.
const invisibleRe = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function cleanText(cell: Cell): string {
  if (cell === null) return '';
  return String(cell)
    .replace(invisibleRe, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

export function isEmptyCell(cell: Cell | undefined): boolean {
  return cell === undefined || cell === null || cleanText(cell) === '';
}

export function isEmptyRow(row: Cell[]): boolean {
  return row.every(isEmptyCell);
}
