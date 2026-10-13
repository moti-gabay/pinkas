/**
 * Loads the synthetic fixture household into a database through the real ingestion path.
 * Used by the demo seed and by the ground-truth test. Settlement/transfer rows are marked excluded
 * here because the automatic linking that does this lands in phase 2.
 */
import { schema, type Db } from '@pinkas/db';
import { generateHousehold, type Household } from '@pinkas/fixtures';
import { and, eq, inArray } from 'drizzle-orm';
import { maskAccount } from '../routes/sources.js';
import { ingest } from '@pinkas/db';

export interface LoadedHousehold {
  household: Household;
  accountIds: Record<string, string>; // fixture account id → db id
  sourceIds: Record<string, string>;
  rowsAdded: number;
}

export async function loadHousehold(
  db: Db,
  opts: { months?: number; seed?: number; endMonth?: string } = {},
): Promise<LoadedHousehold> {
  const household = generateHousehold(opts);
  const sourceIds: Record<string, string> = {};
  const accountIds: Record<string, string> = {};
  for (const acc of household.accounts) {
    let sourceId = sourceIds[acc.companyId];
    if (!sourceId) {
      const [src] = await db
        .insert(schema.sources)
        .values({ kind: 'scraper', companyId: acc.companyId, displayName: acc.companyId })
        .returning({ id: schema.sources.id });
      if (!src) throw new Error('insert failed');
      sourceId = src.id;
      sourceIds[acc.companyId] = sourceId;
    }
    const [row] = await db
      .insert(schema.accounts)
      .values({
        sourceId,
        externalId: acc.externalId,
        maskedLabel: maskAccount(acc.externalId),
        type: acc.type,
        displayName: acc.displayName,
        cardCycleDay: acc.cardCycleDay ?? null,
      })
      .returning({ id: schema.accounts.id });
    if (!row) throw new Error('insert failed');
    accountIds[acc.id] = row.id;
  }
  let rowsAdded = 0;
  for (const acc of household.accounts) {
    const dbAccountId = accountIds[acc.id];
    const sourceId = sourceIds[acc.companyId];
    if (!dbAccountId || !sourceId) continue;
    const rows = household.transactions
      .filter((t) => t.accountId === acc.id)
      .map((t) => ({ ...t, accountId: dbAccountId }));
    const res = await ingest(db, { sourceId, rows });
    rowsAdded += res.rowsAdded;
  }
  // Phase-2 linking stand-in: exclude settlements and own transfers by their fixture tags.
  for (const [tag, reason] of [
    ['card_settlement', 'card_settlement'],
    ['transfer', 'internal_transfer'],
  ] as const) {
    const tagged = household.transactions.filter((t) => t.tag === tag);
    for (const t of tagged) {
      const dbAccountId = accountIds[t.accountId];
      if (!dbAccountId) continue;
      await db
        .update(schema.transactions)
        .set({ excludeReason: reason })
        .where(
          and(
            eq(schema.transactions.accountId, dbAccountId),
            eq(schema.transactions.txnDate, t.txnDate),
            eq(schema.transactions.chargedAmountAgorot, t.chargedAmountAgorot),
            eq(schema.transactions.descriptionRaw, t.descriptionRaw),
          ),
        );
    }
  }
  // sanity: every exclusion landed
  const excluded = await db
    .select({ n: schema.transactions.id })
    .from(schema.transactions)
    .where(inArray(schema.transactions.excludeReason, ['card_settlement', 'internal_transfer']));
  const expectedExcluded = household.transactions.filter(
    (t) => t.tag === 'card_settlement' || t.tag === 'transfer',
  ).length;
  if (excluded.length !== expectedExcluded)
    throw new Error(`exclusion mismatch: ${excluded.length} vs ${expectedExcluded}`);
  return { household, accountIds, sourceIds, rowsAdded };
}
