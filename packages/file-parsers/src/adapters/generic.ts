import { detectHeaderRow, suggestMapping } from '../headers.js';
import type { LoadedFile, SourceAdapter } from '../types.js';

/** Fallback for any CSV/XLSX whose headers the dictionary can read. Bank presets come later. */
export const genericAdapter: SourceAdapter = {
  id: 'generic',
  nameHe: 'כללי',
  formats: ['csv', 'xlsx'],
  detect(file: LoadedFile): number {
    // Low but non-zero so a real preset always wins when one matches.
    return file.tables.some((t) => detectHeaderRow(t) !== undefined) ? 0.1 : 0;
  },
  defaultMapping(table) {
    const headerRowIndex = detectHeaderRow(table);
    return headerRowIndex === undefined ? undefined : suggestMapping(table, headerRowIndex);
  },
};

export const adapters: readonly SourceAdapter[] = [genericAdapter];

export function pickAdapter(file: LoadedFile): SourceAdapter {
  let best = genericAdapter;
  let bestScore = -1;
  for (const adapter of adapters) {
    if (!adapter.formats.includes(file.format)) continue;
    const score = adapter.detect(file);
    if (score > bestScore) {
      best = adapter;
      bestScore = score;
    }
  }
  return best;
}
