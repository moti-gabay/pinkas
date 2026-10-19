/**
 * The scheduler must never turn a failed login into repeated login attempts, including when a sync crashes
 * and the loop keeps running. Runs as the real `pinkas_worker` role.
 */
import { createDb, schema, seedTaxonomy } from '@pinkas/db';
import { startTestDb, type TestDb } from '@pinkas/db/test-db';
import { eq } from 'drizzle-orm';
import sodium from 'libsodium-wrappers';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockScrape } from '../scrapers/mock-scrape.js';
import type { SyncDeps } from './sync-source.js';
import { newTickState, runTick } from './tick.js';

describe('runTick', () => {
  let t: TestDb;
  let deps: SyncDeps;
  const scrape = vi.fn(mockScrape);

  async function makeSource(password: string, cron = '* * * * *') {
    const [src] = await t.db
      .insert(schema.sources)
      .values({ kind: 'scraper', companyId: 'max', displayName: 'max', scheduleCron: cron })
      .returning();
    const ciphertext = sodium.crypto_box_seal(
      sodium.from_string(JSON.stringify({ username: 'u', password })),
      deps.keypair.publicKey,
    );
    await t.db
      .insert(schema.credentials)
      .values({ sourceId: src!.id, ciphertext, keyFingerprint: 'test' });
    return src!.id;
  }
  const clear = async () => {
    await t.pool.query('DELETE FROM sources');
    scrape.mockClear();
  };

  beforeAll(async () => {
    await sodium.ready;
    t = await startTestDb();
    await seedTaxonomy(t.db);
    const kp = sodium.crypto_box_keypair();
    deps = {
      db: createDb(await t.asRole('pinkas_worker')),
      scrape,
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

  it('a login-class failure is attempted once; later ticks and later cron occurrences skip the source', async () => {
    await clear();
    const id = await makeSource('fail:INVALID_PASSWORD');
    const state = newTickState();
    const t0 = new Date('2026-10-14T06:30:05Z');
    expect(await runTick(deps, state, t0)).toEqual({ manual: 0, scheduled: 1 });
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(
      (await t.db.query.sources.findFirst({ where: eq(schema.sources.id, id) }))?.enabled,
    ).toBe(false);

    // Same occurrence again, the next minute's occurrence, and the next day: never scraped again.
    for (const later of ['2026-10-14T06:30:20Z', '2026-10-14T06:31:05Z', '2026-10-15T06:30:05Z']) {
      expect(await runTick(deps, state, new Date(later))).toEqual({ manual: 0, scheduled: 0 });
    }
    // A fresh process (state lost after a restart) also skips it: the guard is the database, not memory.
    expect(await runTick(deps, newTickState(), new Date('2026-10-14T06:32:05Z'))).toEqual({
      manual: 0,
      scheduled: 0,
    });
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(
      await t.db.select().from(schema.syncRuns).where(eq(schema.syncRuns.sourceId, id)),
    ).toHaveLength(1);
  });

  it('a source re-enabled outside the API but still carrying a login-class error is never scheduled', async () => {
    await clear();
    const id = await makeSource('p');
    await t.pool.query(
      "UPDATE sources SET enabled = true, last_error_type = 'INVALID_PASSWORD' WHERE id = $1",
      [id],
    );
    expect(await runTick(deps, newTickState(), new Date('2026-10-14T06:30:05Z'))).toEqual({
      manual: 0,
      scheduled: 0,
    });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('a queued manual run for a disabled source is closed as DISABLED without touching the bank', async () => {
    await clear();
    const id = await makeSource('fail:ACCOUNT_BLOCKED');
    const state = newTickState();
    await runTick(deps, state, new Date('2026-10-14T06:30:05Z'));
    expect(scrape).toHaveBeenCalledTimes(1);
    await t.db
      .insert(schema.syncRuns)
      .values({ sourceId: id, trigger: 'manual', status: 'queued' });
    expect(await runTick(deps, state, new Date('2026-10-14T06:30:20Z'))).toEqual({
      manual: 1,
      scheduled: 0,
    });
    expect(scrape).toHaveBeenCalledTimes(1);
    const runs = await t.db.select().from(schema.syncRuns).where(eq(schema.syncRuns.sourceId, id));
    expect(runs.map((r) => r.errorType).sort()).toEqual(['ACCOUNT_BLOCKED', 'DISABLED']);
    expect(runs.some((r) => r.status === 'queued')).toBe(false);
    // The DISABLED run must not erase the login marker the API uses to refuse a plain re-enable.
    expect(
      (await t.db.query.sources.findFirst({ where: eq(schema.sources.id, id) }))?.lastErrorType,
    ).toBe('ACCOUNT_BLOCKED');
  });

  it('a crashing sync does not stop the tick, and is not re-run for the same cron occurrence', async () => {
    await clear();
    const bad = await makeSource('p');
    const good = await makeSource('p');
    await t.pool.query('DELETE FROM credentials WHERE source_id = $1', [bad]); // closes as NO_CREDENTIALS
    const crashing: SyncDeps = {
      ...deps,
      scrape: vi.fn(async () => {
        throw new Error('chromium died');
      }),
    };
    const state = newTickState();
    const t0 = new Date('2026-10-14T06:30:05Z');
    expect(await runTick(crashing, state, t0)).toEqual({ manual: 0, scheduled: 2 });
    expect(crashing.scrape).toHaveBeenCalledTimes(1);
    expect(await runTick(crashing, state, new Date('2026-10-14T06:30:20Z'))).toEqual({
      manual: 0,
      scheduled: 0,
    });
    expect(crashing.scrape).toHaveBeenCalledTimes(1);
    // Non-login failures keep the source enabled; it runs again only at the next cron occurrence.
    expect(
      (await t.db.query.sources.findFirst({ where: eq(schema.sources.id, good) }))?.enabled,
    ).toBe(true);
    expect(await runTick(deps, state, new Date('2026-10-14T06:31:05Z'))).toEqual({
      manual: 0,
      scheduled: 2,
    });
    expect(scrape).toHaveBeenCalledTimes(1);
  });

  it('fires a daily schedule once, only at its time (Asia/Jerusalem)', async () => {
    await clear();
    await makeSource('p', '30 6 * * *');
    const state = newTickState();
    expect(await runTick(deps, state, new Date('2026-10-14T03:29:50Z'))).toEqual({
      manual: 0,
      scheduled: 0,
    }); // 06:29:50 IDT
    expect(await runTick(deps, state, new Date('2026-10-14T03:30:05Z'))).toEqual({
      manual: 0,
      scheduled: 1,
    }); // 06:30:05 IDT
    expect(await runTick(deps, state, new Date('2026-10-14T03:30:20Z'))).toEqual({
      manual: 0,
      scheduled: 0,
    });
    expect(await runTick(deps, state, new Date('2026-10-14T09:00:00Z'))).toEqual({
      manual: 0,
      scheduled: 0,
    });
    expect(scrape).toHaveBeenCalledTimes(1);
  });
});
