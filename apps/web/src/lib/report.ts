import type { MonthReportDto } from '@pinkas/shared';

/** Relative change as a ratio (0.1 = +10%); null when there is no meaningful baseline. */
export function deltaPercent(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export interface CategoryShare {
  categoryId: string | null;
  nameHe: string;
  /** Positive magnitude of spending. */
  amountAgorot: number;
  txnCount: number;
  /** 0..1 of total expenses. */
  share: number;
}

/** Rolls expense rows up into their top-level parents, sorted by amount desc. */
export function rollupExpenses(
  byCategory: MonthReportDto['byCategory'],
  categories: readonly { id: string; nameHe: string }[],
): CategoryShare[] {
  const names = new Map(categories.map((c) => [c.id, c.nameHe]));
  const groups = new Map<string | null, CategoryShare>();
  for (const row of byCategory) {
    if (row.kind !== 'expense') continue;
    const topId = row.parentId ?? row.categoryId;
    const existing = groups.get(topId);
    if (existing) {
      existing.amountAgorot += -row.amountAgorot;
      existing.txnCount += row.txnCount;
      continue;
    }
    const nameHe = row.parentId === null ? row.nameHe : (names.get(row.parentId) ?? row.nameHe);
    groups.set(topId, {
      categoryId: topId,
      nameHe,
      amountAgorot: -row.amountAgorot,
      txnCount: row.txnCount,
      share: 0,
    });
  }
  const list = [...groups.values()].filter((g) => g.amountAgorot > 0);
  const total = list.reduce((a, g) => a + g.amountAgorot, 0);
  for (const g of list) g.share = total === 0 ? 0 : g.amountAgorot / total;
  return list.sort((a, b) => b.amountAgorot - a.amountAgorot);
}
