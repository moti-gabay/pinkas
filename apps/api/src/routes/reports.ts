import { schema } from '@pinkas/db';
import { addMonths, monthRange, summarizeMonth, type SummaryRow } from '@pinkas/domain';
import { UNCATEGORIZED_SLUG, isoMonth, monthReportDto } from '@pinkas/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

type Db = Parameters<FastifyPluginAsyncZod>[0]['db'];

/** Loads counted rows for [fromMonth, toMonth] with the category kind resolved, then lets the domain sum them. */
export async function loadSummaryRows(
  db: Db,
  fromMonth: string,
  toMonth: string,
): Promise<(SummaryRow & { categoryId: string | undefined })[]> {
  const t = schema.transactions;
  const c = schema.categories;
  const rows = await db
    .select({
      txnDate: t.txnDate,
      chargedAmountAgorot: t.chargedAmountAgorot,
      categoryId: t.categoryId,
      categoryKind: c.kind,
      categorySlug: c.slug,
      isFixed: sql<boolean>`coalesce(${t.isFixed}, ${c.isFixedDefault}, false)`,
      excludeReason: t.excludeReason,
    })
    .from(t)
    .leftJoin(c, eq(c.id, t.categoryId))
    .where(and(gte(t.txnDate, monthRange(fromMonth).from), lte(t.txnDate, monthRange(toMonth).to)));
  // The 'uncategorized' system category carries no meaning for income vs. expense: such rows follow their sign.
  return rows.map((r) => ({
    ...r,
    categoryId: r.categoryId ?? undefined,
    categoryKind: r.categorySlug === UNCATEGORIZED_SLUG ? undefined : (r.categoryKind ?? undefined),
    excludeReason: r.excludeReason ?? undefined,
  }));
}

function avg(summaries: ReturnType<typeof summarizeMonth>[]) {
  if (summaries.length === 0) return null;
  const n = summaries.length;
  const mean = (k: 'incomeAgorot' | 'expensesAgorot' | 'netAgorot') =>
    Math.round(summaries.reduce((a, s) => a + s[k], 0) / n);
  return {
    incomeAgorot: mean('incomeAgorot'),
    expensesAgorot: mean('expensesAgorot'),
    netAgorot: mean('netAgorot'),
  };
}

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/reports/month/:month',
    { schema: { params: z.object({ month: isoMonth }), response: { 200: monthReportDto } } },
    async (req) => {
      const { month } = req.params;
      const rows = await loadSummaryRows(app.db, addMonths(month, -6), month);
      const current = summarizeMonth(rows, month);
      const history = [1, 2, 3, 4, 5, 6].map((i) => summarizeMonth(rows, addMonths(month, -i)));
      const withData = (list: typeof history) => list.filter((s) => s.countedRows > 0);
      const categories = await app.db.select().from(schema.categories);
      const bySlug = new Map(categories.map((c) => [c.id, c]));
      const counts = new Map<string, number>();
      for (const r of rows)
        if (r.txnDate.startsWith(month) && r.excludeReason === undefined)
          counts.set(
            r.categoryId ?? 'uncategorized',
            (counts.get(r.categoryId ?? 'uncategorized') ?? 0) + 1,
          );
      const byCategory = Object.entries(current.byCategory).map(([id, amountAgorot]) => {
        const cat = bySlug.get(id);
        return {
          categoryId: cat?.id ?? null,
          slug: cat?.slug ?? 'uncategorized',
          nameHe: cat?.nameHe ?? 'ללא קטגוריה',
          parentId: cat?.parentId ?? null,
          kind: cat?.kind ?? 'expense',
          amountAgorot,
          txnCount: counts.get(id) ?? 0,
        };
      });
      const prev = history[0];
      return {
        month,
        incomeAgorot: current.incomeAgorot,
        expensesAgorot: current.expensesAgorot,
        netAgorot: current.netAgorot,
        fixedAgorot: current.fixedAgorot,
        variableAgorot: current.variableAgorot,
        countedRows: current.countedRows,
        byCategory,
        previous:
          prev && prev.countedRows > 0
            ? {
                incomeAgorot: prev.incomeAgorot,
                expensesAgorot: prev.expensesAgorot,
                netAgorot: prev.netAgorot,
              }
            : null,
        avg3: avg(withData(history.slice(0, 3))),
        avg6: avg(withData(history)),
      };
    },
  );
};
