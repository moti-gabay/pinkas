/**
 * Contract tests: the pipeline against synthetic scraper results, never a real bank.
 * The pipeline's DB handle connects as the real `pinkas_worker` role, so a missing or excessive grant fails here.
 * `t.db` (superuser) is used only to arrange fixtures and assert outcomes.
 */
import { createDb, ingest, schema, seedTaxonomy } from '@pinkas/db';
import { startTestDb, type TestDb } from '@pinkas/db/test-db';
import { eq } from 'drizzle-orm';
import sodium from 'libsodium-wrappers';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockScrape } from '../scrapers/mock-scrape.js';
import { startDateFor, syncSource, type SyncDeps } from './sync-source.js';

describe('syncSource', () => {
  let t: TestDb;
  let deps: SyncDeps;
  const seal = (creds: Record<string, string>) =>
    sodium.crypto_box_seal(sodium.from_string(JSON.stringify(creds)), deps.keypair.publicKey);

  async function makeSource(companyId: string, creds: Record<string, string>) {
    const [src] = await t.db
      .insert(schema.sources)
      .values({ kind: 'scraper', companyId, displayName: companyId })
      .returning();
    if (!src) throw new Error('insert failed');
    await t.db
      .insert(schema.credentials)
      .values({ sourceId: src.id, ciphertext: seal(creds), keyFingerprint: 'test' });
    return src.id;
  }

  beforeAll(async () => {
    await sodium.ready;
    t = await startTestDb();
    await seedTaxonomy(t.db);
    const kp = sodium.crypto_box_keypair();
    deps = {
      db: createDb(await t.asRole('pinkas_worker')),
      scrape: vi.fn(mockScrape),
      keypair: { publicKey: kp.publicKey, privateKey: kp.privateKey },
      log: pino({ level: 'silent' }),
      executablePath: '/usr/bin/chromium',
      timeoutMs: 1000,
      historyMonths: 12,
      proxyUrl: undefined,
    };
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  it('syncs a bank and two cards, links settlements, and a second run adds nothing', async () => {
    const bank = await makeSource('beinleumi', { username: 'u', password: 'p' });
    const max = await makeSource('max', { username: 'u', password: 'p' });
    const r1 = await syncSource(deps, bank, 'manual');
    const r2 = await syncSource(deps, max, 'schedule');
    expect(r1.status).toBe('success');
    expect(r2.status).toBe('success');
    expect(r1.rowsAdded).toBeGreaterThan(20);
    const accounts = await t.db.select().from(schema.accounts);
    expect(accounts.map((a) => a.type).sort()).toEqual(['checking', 'credit_card']);
    expect(accounts.every((a) => a.maskedLabel.startsWith('****'))).toBe(true);
    const settlements = await t.db.select().from(schema.cardSettlements);
    expect(settlements.length).toBeGreaterThan(0);
    expect(settlements.every((s) => s.status === 'matched')).toBe(true);

    const again = await syncSource(deps, bank, 'manual');
    expect(again).toMatchObject({ status: 'success', rowsAdded: 0 });
    const src = await t.db.query.sources.findFirst({ where: eq(schema.sources.id, bank) });
    expect(src?.lastSuccessAt).not.toBeNull();
    const runs = await t.db
      .select()
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.sourceId, bank));
    expect(runs.map((r) => r.status)).toEqual(['success', 'success']);
    expect(runs[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    'INVALID_PASSWORD',
    'CHANGE_PASSWORD',
    'ACCOUNT_BLOCKED',
    'TWO_FACTOR_RETRIEVER_MISSING',
  ])('%s disables the source after exactly one attempt', async (errorType) => {
    const id = await makeSource('visaCal', { username: 'u', password: `fail:${errorType}` });
    const spy = deps.scrape as ReturnType<typeof vi.fn>;
    spy.mockClear();
    const res = await syncSource(deps, id, 'schedule');
    expect(res).toMatchObject({ status: 'failed', errorType });
    expect(spy).toHaveBeenCalledTimes(1);
    const src = await t.db.query.sources.findFirst({ where: eq(schema.sources.id, id) });
    expect(src?.enabled).toBe(false);
    expect(src?.lastErrorType).toBe(errorType);
    // A disabled source is never scraped again, even when asked.
    const second = await syncSource(deps, id, 'manual');
    expect(second.errorType).toBe('DISABLED');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['TIMEOUT', 'GENERIC', 'GENERAL_ERROR'])(
    '%s fails the run but keeps the source enabled',
    async (errorType) => {
      const id = await makeSource('max', { username: 'u', password: `fail:${errorType}` });
      const res = await syncSource(deps, id, 'schedule');
      expect(res).toMatchObject({ status: 'failed', errorType });
      expect(
        (await t.db.query.sources.findFirst({ where: eq(schema.sources.id, id) }))?.enabled,
      ).toBe(true);
    },
  );

  it('a thrown scraper exception is recorded as GENERIC without leaking details', async () => {
    const id = await makeSource('max', { username: 'u', password: 'p' });
    const throwing: SyncDeps = {
      ...deps,
      scrape: async () => {
        throw new Error('page content with password=p');
      },
    };
    const res = await syncSource(throwing, id, 'manual');
    expect(res).toMatchObject({ status: 'failed', errorType: 'GENERIC' });
    const run = await t.db.query.syncRuns.findFirst({ where: eq(schema.syncRuns.sourceId, id) });
    expect(run?.errorMessage).not.toContain('password=');
  });

  it('sticky hash-kind downgrade works with the worker role (sync N collides, sync N+1 adds nothing)', async () => {
    const id = await makeSource('beinleumi', { username: 'u', password: 'p' });
    const [acc] = await t.db
      .insert(schema.accounts)
      .values({
        sourceId: id,
        externalId: '99-1',
        maskedLabel: '****0001',
        type: 'checking',
        displayName: 'x',
      })
      .returning();
    const row = (ext: string, date: string, amount: number) => ({
      accountId: acc!.id,
      origin: 'scraper' as const,
      externalIdentifier: ext,
      txnDate: date,
      processedDate: undefined,
      chargedAmountAgorot: amount,
      originalAmountMinor: undefined,
      originalCurrency: undefined,
      status: 'completed' as const,
      descriptionRaw: 'העברה',
      memo: undefined,
      installmentNumber: undefined,
      installmentTotal: undefined,
    });
    await ingest(deps.db, { sourceId: id, rows: [row('7', '2026-05-01', -100)] });
    const collide = [row('7', '2026-05-01', -100), row('7', '2026-05-09', -999)];
    expect(await ingest(deps.db, { sourceId: id, rows: collide })).toMatchObject({
      rowsAdded: 1,
      downgraded: true,
      hashKind: 'fields',
    });
    expect(await ingest(deps.db, { sourceId: id, rows: collide })).toMatchObject({
      rowsAdded: 0,
      downgraded: false,
      hashKind: 'fields',
    });
  });

  it('startDateFor overlaps the last success by two weeks but never beyond the backfill horizon', () => {
    const now = new Date('2026-10-13T00:00:00Z');
    expect(startDateFor(null, 12, now).toISOString().slice(0, 10)).toBe('2025-10-13');
    expect(startDateFor(new Date('2026-10-01T00:00:00Z'), 12, now).toISOString().slice(0, 10)).toBe(
      '2026-09-17',
    );
    expect(startDateFor(new Date('2020-01-01T00:00:00Z'), 12, now).toISOString().slice(0, 10)).toBe(
      '2025-10-13',
    );
  });
});
