import { parse } from 'csv-parse/sync';
import type { Cell } from './types.js';

export type Delimiter = ',' | ';' | '\t';

const candidates: Delimiter[] = [',', ';', '\t'];

/**
 * Picks the delimiter that appears on the most of the first 20 non-blank lines. Title rows above
 * the headers often have no delimiter at all, so we only require a majority of lines.
 */
export function detectDelimiter(text: string): Delimiter | undefined {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20);
  if (lines.length === 0) return undefined;
  let best: { delimiter: Delimiter; lines: number; total: number } | undefined;
  for (const delimiter of candidates) {
    let linesHit = 0;
    let total = 0;
    for (const line of lines) {
      const n = line.split(delimiter).length - 1;
      if (n > 0) linesHit += 1;
      total += n;
    }
    if (!best || linesHit > best.lines || (linesHit === best.lines && total > best.total)) {
      best = { delimiter, lines: linesHit, total };
    }
  }
  if (!best || best.lines * 2 < lines.length) return undefined;
  return best.delimiter;
}

/** Cells stay strings; blank lines become empty records so row indices match the file. */
export function parseCsv(text: string, delimiter: Delimiter): Cell[][] {
  const records = parse(text, {
    delimiter,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: false,
    trim: false,
  });
  return records.map((r) => (r.length === 1 && r[0] === '' ? [] : r));
}
