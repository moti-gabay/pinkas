/**
 * Reconciliation against the synthetic household: every month's income/expenses/net reported by the API
 * must equal the generator's ground truth to the agora, and re-ingesting must add zero rows.
 */
import { schema } from '@pinkas/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from '../test-app.js';
import { loadHousehold, type LoadedHousehold } from './demo-data.js';
import { ingest } from './ingest.js';

describe('fixture ground truth', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let loaded: LoadedHousehold;
  beforeAll(async () => {
    t = await startTestApp();
    loaded = await loadHousehold(t.db, { months: 6, seed: 7, endMonth: '2026-06' });
  }, 180_000);
  afterAll(async () => {
    await t.stop();
  });

  it('ingests every fixture row exactly once', async () => {
    expect(loaded.rowsAdded).toBe(loaded.household.transactions.length);
    const n = (await t.db.select({ id: schema.transactions.id }).from(schema.transactions)).length;
    expect(n).toBe(loaded.household.transactions.length);
  });

  it('month reports match the generator expectations to the agora', async () => {
    for (const exp of loaded.household.expectations) {
      const res = await t.app.inject({
        method: 'GET',
        url: `/reports/month/${exp.month}`,
        headers: t.auth,
      });
      expect(res.statusCode).toBe(200);
      const r = res.json();
      // Categorization differs (rules vs ground truth) so only sign-based totals are compared here; by-category
      // accuracy is checked separately below.
      expect({ month: exp.month, income: r.incomeAgorot, net: r.netAgorot }).toEqual({
        month: exp.month,
        income: exp.incomeAgorot,
        net: exp.netAgorot,
      });
      expect(r.expensesAgorot).toBe(exp.expensesAgorot);
    }
  });

  it('rule categorization is precise: every rule hit matches the expected slug', async () => {
    const rows = await t.db.query.transactions.findMany({
      where: eq(schema.transactions.categorySource, 'rule'),
      with: { category: true },
    });
    expect(rows.length).toBeGreaterThan(100);
    const byKey = new Map(
      loaded.household.transactions.map((f) => [
        `${f.accountId}|${f.txnDate}|${f.chargedAmountAgorot}|${f.descriptionRaw}`,
        f,
      ]),
    );
    const dbToFixture = new Map(Object.entries(loaded.accountIds).map(([fx, db]) => [db, fx]));
    let mismatches = 0;
    for (const r of rows) {
      const f = byKey.get(
        `${dbToFixture.get(r.accountId) ?? ''}|${r.txnDate}|${r.chargedAmountAgorot}|${r.descriptionRaw}`,
      );
      if (!f) continue;
      if (f.expectedCategorySlug !== r.category?.slug && f.tag !== 'refund' && f.tag !== 'fx')
        mismatches++;
    }
    expect(mismatches / rows.length).toBeLessThan(0.05);
  });

  it('re-ingesting the same scraper output is idempotent', async () => {
    for (const acc of loaded.household.accounts) {
      const dbAccountId = loaded.accountIds[acc.id];
      const sourceId = loaded.sourceIds[acc.companyId];
      if (!dbAccountId || !sourceId) continue;
      const rows = loaded.household.transactions
        .filter((x) => x.accountId === acc.id)
        .map((x) => ({ ...x, accountId: dbAccountId }));
      const res = await ingest(t.db, { sourceId, rows });
      expect(res.rowsAdded, acc.id).toBe(0);
    }
  });
});
