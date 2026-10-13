/**
 * One sync of one source: decrypt → scrape → map → upsert accounts → ingest → relink → record the run.
 * Login-class failures disable the source and are never retried (repeated failed logins lock bank accounts).
 */
import { ingest, relink, schema, type Db } from '@pinkas/db';
import { loginClassErrors, type ScraperErrorType } from '@pinkas/shared';
import { and, eq } from 'drizzle-orm';
import type pino from 'pino';
import { openCredentials, wipe, type Keypair } from '../credentials/open.js';
import { mapResult } from '../scrapers/map-result.js';
import type { ScrapeFn } from '../scrapers/run-scrape.js';

export interface SyncDeps {
  db: Db;
  scrape: ScrapeFn;
  keypair: Keypair;
  log: pino.Logger;
  executablePath: string;
  timeoutMs: number;
  historyMonths: number;
  proxyUrl: string | undefined;
}

export interface SyncOutcome {
  runId: string;
  status: 'success' | 'failed' | 'partial';
  errorType: string | undefined;
  rowsAdded: number;
  rowsUpdated: number;
}

export function maskAccount(externalId: string): string {
  const digits = externalId.replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

export function startDateFor(
  lastSuccessAt: Date | null,
  historyMonths: number,
  now = new Date(),
): Date {
  const backfill = new Date(now);
  backfill.setMonth(backfill.getMonth() - historyMonths);
  if (!lastSuccessAt) return backfill;
  // Re-scan two weeks before the last success so late-posting rows and pending→completed updates are caught.
  const overlap = new Date(lastSuccessAt.getTime() - 14 * 86_400_000);
  return overlap > backfill ? overlap : backfill;
}

export async function syncSource(
  deps: SyncDeps,
  sourceId: string,
  trigger: 'schedule' | 'manual',
  existingRunId?: string,
): Promise<SyncOutcome> {
  const { db, log } = deps;
  const started = Date.now();
  const source = await db.query.sources.findFirst({ where: eq(schema.sources.id, sourceId) });
  if (source?.kind !== 'scraper' || !source.companyId)
    throw new Error(`source ${sourceId} is not a scraper source`);
  let runId = existingRunId;
  if (runId) {
    await db
      .update(schema.syncRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(schema.syncRuns.id, runId));
  } else {
    const [run] = await db
      .insert(schema.syncRuns)
      .values({ sourceId, trigger, status: 'running' })
      .returning({ id: schema.syncRuns.id });
    if (!run) throw new Error('insert failed');
    runId = run.id;
  }
  const runLog = log.child({ runId, sourceId, companyId: source.companyId, trigger });

  const finish = async (
    status: SyncOutcome['status'],
    fields: Partial<typeof schema.syncRuns.$inferInsert>,
    errorType?: string,
  ): Promise<SyncOutcome> => {
    const durationMs = Date.now() - started;
    await db
      .update(schema.syncRuns)
      .set({ status, finishedAt: new Date(), durationMs, errorType: errorType ?? null, ...fields })
      .where(eq(schema.syncRuns.id, runId));
    if (status === 'success') {
      await db
        .update(schema.sources)
        .set({ lastSuccessAt: new Date(), lastErrorType: null, lastErrorAt: null })
        .where(eq(schema.sources.id, sourceId));
    } else {
      await db
        .update(schema.sources)
        .set({ lastErrorType: errorType ?? 'GENERIC', lastErrorAt: new Date() })
        .where(eq(schema.sources.id, sourceId));
    }
    runLog.info({ status, errorType, durationMs, ...fields }, 'sync finished');
    return {
      runId,
      status,
      errorType,
      rowsAdded: fields.rowsAdded ?? 0,
      rowsUpdated: fields.rowsUpdated ?? 0,
    };
  };

  if (!source.enabled) return finish('failed', { errorMessage: 'source disabled' }, 'DISABLED');
  const cred = await db.query.credentials.findFirst({
    where: eq(schema.credentials.sourceId, sourceId),
  });
  if (!cred) return finish('failed', { errorMessage: 'no credentials' }, 'NO_CREDENTIALS');

  let result;
  let credentials: Record<string, string> | undefined;
  try {
    credentials = await openCredentials(cred.ciphertext, deps.keypair);
    result = await deps.scrape(
      {
        companyId: source.companyId,
        startDate: startDateFor(source.lastSuccessAt, deps.historyMonths),
        executablePath: deps.executablePath,
        timeoutMs: deps.timeoutMs,
        proxyUrl: deps.proxyUrl,
      },
      credentials,
    );
  } catch (err) {
    // Never log the error object itself: library errors can embed page content or form data.
    runLog.error({ errName: err instanceof Error ? err.name : typeof err }, 'scrape threw');
    return await finish('failed', { errorMessage: 'scraper threw an exception' }, 'GENERIC');
  } finally {
    if (credentials) wipe(credentials);
  }

  if (!result.success) {
    const errorType = (result.errorType ?? 'GENERIC') as ScraperErrorType;
    if (loginClassErrors.has(errorType)) {
      // Stop here. No retry, and the source stays disabled until the user re-enters credentials.
      await db
        .update(schema.sources)
        .set({ enabled: false })
        .where(eq(schema.sources.id, sourceId));
      runLog.warn({ errorType }, 'login-class failure: source disabled');
    }
    return finish('failed', { errorMessage: `scraper returned ${errorType}` }, errorType);
  }

  const mapped = mapResult(result);
  let rowsAdded = 0;
  let rowsUpdated = 0;
  for (const acc of mapped) {
    let account = await db.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.sourceId, sourceId),
        eq(schema.accounts.externalId, acc.accountNumber),
      ),
    });
    if (!account) {
      const type = ['max', 'visaCal', 'isracard', 'amex'].includes(source.companyId)
        ? 'credit_card'
        : 'checking';
      const [created] = await db
        .insert(schema.accounts)
        .values({
          sourceId,
          externalId: acc.accountNumber,
          maskedLabel: maskAccount(acc.accountNumber),
          type,
          displayName: `${source.displayName} ${maskAccount(acc.accountNumber)}`,
        })
        .returning();
      account = created;
      if (!account) throw new Error('insert failed');
    }
    if (acc.balanceAgorot !== undefined) {
      const asOf = acc.balanceDate ? new Date(acc.balanceDate) : new Date();
      await db
        .update(schema.accounts)
        .set({ balanceAgorot: acc.balanceAgorot, balanceAt: asOf })
        .where(eq(schema.accounts.id, account.id));
      await db
        .insert(schema.balanceSnapshots)
        .values({ accountId: account.id, asOf, balanceAgorot: acc.balanceAgorot })
        .onConflictDoNothing();
    }
    const accountId = account.id;
    const res = await ingest(db, { sourceId, rows: acc.rows.map((r) => ({ ...r, accountId })) });
    rowsAdded += res.rowsAdded;
    rowsUpdated += res.rowsUpdated;
    if (res.downgraded) runLog.warn('identifier collision: source downgraded to field hashing');
  }
  const links = await relink(db);
  return finish(mapped.length === 0 ? 'partial' : 'success', {
    accountsSeen: mapped.length,
    rowsAdded,
    rowsUpdated,
    rowsLinked: links.settlements + links.transfers + links.refunds,
  });
}
