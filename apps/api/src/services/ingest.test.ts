import { schema } from '@pinkas/db';
import type { NormalizedTxn } from '@pinkas/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from '../test-app.js';
import { ingest } from './ingest.js';

const base = (accountId: string, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  accountId,
  origin: 'scraper',
  externalIdentifier: undefined,
  txnDate: '2026-03-07',
  processedDate: undefined,
  chargedAmountAgorot: -12345,
  originalAmountMinor: undefined,
  originalCurrency: undefined,
  status: 'completed',
  descriptionRaw: 'שופרסל דיל סניף רמת גן',
  memo: undefined,
  installmentNumber: undefined,
  installmentTotal: undefined,
  ...over,
});

describe('ingest', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let sourceId: string;
  let accountId: string;
  beforeAll(async () => {
    t = await startTestApp();
    const [s] = await t.db
      .insert(schema.sources)
      .values({ kind: 'scraper', companyId: 'beinleumi', displayName: 'בינלאומי' })
      .returning();
    sourceId = s!.id;
    const [a] = await t.db
      .insert(schema.accounts)
      .values({
        sourceId,
        externalId: '123456789',
        maskedLabel: '****6789',
        type: 'checking',
        displayName: 'עו"ש',
      })
      .returning();
    accountId = a!.id;
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  const count = async () =>
    (
      await t.db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.accountId, accountId))
    ).length;

  it('is idempotent, keeps genuine duplicates, categorizes by rules, and dry-run writes nothing', async () => {
    const rows = [
      base(accountId),
      base(accountId),
      base(accountId, { descriptionRaw: 'סופר פארם', chargedAmountAgorot: -5000 }),
      base(accountId, { descriptionRaw: 'מישהו לא ידוע', chargedAmountAgorot: -700 }),
    ];
    const dry = await ingest(t.db, { sourceId, rows, dryRun: true });
    expect(dry.rowsAdded).toBe(4);
    expect(await count()).toBe(0);
    const first = await ingest(t.db, { sourceId, rows });
    expect(first).toMatchObject({
      rowsAdded: 4,
      rowsUpdated: 0,
      rowsDuplicate: 0,
      hashKind: 'identifier',
      downgraded: false,
    });
    const again = await ingest(t.db, { sourceId, rows });
    expect(again).toMatchObject({ rowsAdded: 0, rowsDuplicate: 4 });
    expect(await count()).toBe(4);
    const stored = await t.db.query.transactions.findMany({
      where: eq(schema.transactions.accountId, accountId),
      with: { category: true },
    });
    const bySlug = Object.fromEntries(stored.map((s) => [s.descriptionRaw, s.category?.slug]));
    expect(bySlug['סופר פארם']).toBe('health.pharmacy');
    expect(bySlug['מישהו לא ידוע']).toBe('uncategorized');
    expect(stored.find((s) => s.descriptionRaw === 'סופר פארם')?.categorySource).toBe('rule');
  });

  it('updates a pending row in place when it posts with a slightly different amount and date', async () => {
    const pending = base(accountId, {
      descriptionRaw: 'WOLT',
      chargedAmountAgorot: -8000,
      status: 'pending',
      txnDate: '2026-04-01',
    });
    await ingest(t.db, { sourceId, rows: [pending] });
    const before = await count();
    const posted = base(accountId, {
      descriptionRaw: 'WOLT *4421',
      chargedAmountAgorot: -8120,
      status: 'completed',
      txnDate: '2026-04-03',
    });
    const res = await ingest(t.db, { sourceId, rows: [posted] });
    expect(res).toMatchObject({ rowsAdded: 0, rowsUpdated: 1 });
    expect(await count()).toBe(before);
    const row = await t.db.query.transactions.findFirst({
      where: eq(schema.transactions.descriptionRaw, 'WOLT *4421'),
    });
    expect(row).toMatchObject({
      status: 'completed',
      chargedAmountAgorot: -8120,
      txnDate: '2026-04-03',
    });
    expect(row?.previousHashes.length).toBe(1);
  });

  it('uses identifier hashes, then downgrades the source stickily on a collision and stays idempotent', async () => {
    const withIds = [
      base(accountId, { externalIdentifier: '1001', txnDate: '2026-05-01' }),
      base(accountId, {
        externalIdentifier: '1002',
        txnDate: '2026-05-02',
        chargedAmountAgorot: -2000,
      }),
    ];
    const r1 = await ingest(t.db, { sourceId, rows: withIds });
    expect(r1).toMatchObject({ rowsAdded: 2, hashKind: 'identifier', downgraded: false });
    const idRows = await t.db.query.transactions.findMany({
      where: eq(schema.transactions.hashKind, 'identifier'),
    });
    expect(idRows.length).toBe(2);

    // Sync N: the bank reuses identifier 1001 for a different transaction → collision.
    const collision = [
      ...withIds,
      base(accountId, {
        externalIdentifier: '1001',
        txnDate: '2026-05-09',
        chargedAmountAgorot: -999,
      }),
    ];
    const r2 = await ingest(t.db, { sourceId, rows: collision });
    expect(r2).toMatchObject({
      rowsAdded: 1,
      rowsDuplicate: 2,
      hashKind: 'fields',
      downgraded: true,
    });
    const src = await t.db.query.sources.findFirst({ where: eq(schema.sources.id, sourceId) });
    expect(src?.hashKind).toBe('fields');
    expect(src?.hashKindDowngradedAt).not.toBeNull();
    expect(
      (
        await t.db.query.transactions.findMany({
          where: eq(schema.transactions.hashKind, 'identifier'),
        })
      ).length,
    ).toBe(0);
    const recomputed = await t.db.query.transactions.findFirst({
      where: eq(schema.transactions.externalIdentifier, '1002'),
    });
    expect(recomputed?.previousHashes.length).toBe(1);

    // Sync N+1: no collision this time; must NOT flip back and must add nothing.
    const total = await count();
    const r3 = await ingest(t.db, { sourceId, rows: collision });
    expect(r3).toMatchObject({
      rowsAdded: 0,
      rowsDuplicate: 3,
      hashKind: 'fields',
      downgraded: false,
    });
    expect(await count()).toBe(total);
    await expect(
      t.pool.query("UPDATE sources SET hash_kind = 'identifier' WHERE id = $1", [sourceId]),
    ).rejects.toThrow(/cannot be upgraded/);
  });
});
