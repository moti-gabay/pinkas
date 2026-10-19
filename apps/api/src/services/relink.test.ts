/** relink() must reproduce the fixture's ground truth without any tag hints: settlements, transfers, refunds. */
import { relink, schema } from '@pinkas/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from '../test-app.js';
import { loadHousehold, type LoadedHousehold } from './demo-data.js';

describe('relink', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let loaded: LoadedHousehold;
  beforeAll(async () => {
    t = await startTestApp();
    loaded = await loadHousehold(t.db, {
      months: 6,
      seed: 11,
      endMonth: '2026-06',
      excludeByTag: false,
    });
  }, 180_000);
  afterAll(async () => {
    await t.stop();
  });

  it('links every settlement exactly, pairs all transfers, categorizes refunds, and is idempotent', async () => {
    const first = await relink(t.db);
    const fx = loaded.household.transactions;
    expect(first.settlements).toBe(fx.filter((x) => x.tag === 'card_settlement').length);
    expect(first.transfers).toBe(fx.filter((x) => x.tag === 'transfer').length / 2);
    expect(first.refunds).toBe(fx.filter((x) => x.tag === 'refund').length);
    const settlements = await t.db.select().from(schema.cardSettlements);
    expect(settlements.every((s) => s.status === 'matched' && s.diffAgorot === 0)).toBe(true);

    const second = await relink(t.db);
    expect(second).toEqual({
      settlements: first.settlements,
      transfers: first.transfers,
      refunds: 0,
    });
    expect((await t.db.select().from(schema.transactionLinks)).length).toBe(
      first.transfers + first.refunds,
    );
  });

  it('after relink the month reports equal the ground truth', async () => {
    for (const exp of loaded.household.expectations) {
      const r = (
        await t.app.inject({ method: 'GET', url: `/reports/month/${exp.month}`, headers: t.auth })
      ).json();
      expect({ m: exp.month, i: r.incomeAgorot, e: r.expensesAgorot, n: r.netAgorot }).toEqual({
        m: exp.month,
        i: exp.incomeAgorot,
        e: exp.expensesAgorot,
        n: exp.netAgorot,
      });
    }
  });

  it('respects a user exclusion/unlink decision', async () => {
    const link = (
      await t.db
        .select()
        .from(schema.transactionLinks)
        .where(eq(schema.transactionLinks.kind, 'transfer'))
    )[0]!;
    await t.db
      .update(schema.transactionLinks)
      .set({ createdBy: 'user' })
      .where(eq(schema.transactionLinks.id, link.id));
    await t.db
      .update(schema.transactions)
      .set({ excludeReason: 'user' })
      .where(eq(schema.transactions.id, link.fromTxnId));
    await relink(t.db);
    const row = await t.db.query.transactions.findFirst({
      where: eq(schema.transactions.id, link.fromTxnId),
    });
    expect(row?.excludeReason).toBe('user');
    expect(
      await t.db.query.transactionLinks.findFirst({
        where: eq(schema.transactionLinks.id, link.id),
      }),
    ).toBeDefined();
  });
});

describe('reconciliation API', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => {
    t = await startTestApp();
    await loadHousehold(t.db, { months: 4, seed: 5, endMonth: '2026-04', excludeByTag: false });
    await relink(t.db);
  }, 180_000);
  afterAll(async () => {
    await t.stop();
  });

  it('lists settlements and transfers; unlinking a transfer survives relink', async () => {
    const before = (
      await t.app.inject({ method: 'GET', url: '/reconciliation', headers: t.auth })
    ).json();
    expect(before.settlements.length).toBeGreaterThan(0);
    expect(before.transfers.length).toBeGreaterThan(0);
    const link = before.transfers[0];
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/reconciliation/transfers/${link.linkId}`,
      headers: t.auth,
    });
    expect(del.statusCode).toBe(200);
    await t.app.inject({ method: 'POST', url: '/reconciliation/relink', headers: t.auth });
    const after = (
      await t.app.inject({ method: 'GET', url: '/reconciliation', headers: t.auth })
    ).json();
    expect(after.transfers.length).toBe(before.transfers.length - 1);
    const leg = await t.db.query.transactions.findFirst({
      where: eq(schema.transactions.id, link.from.txnId),
    });
    expect(leg?.excludeReason).toBeNull();
  });
});
