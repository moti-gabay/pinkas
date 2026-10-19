/**
 * One scheduler tick: run queued manual requests, then fire scheduled sources whose cron is due.
 *
 * No-retry guarantee: nothing here re-runs a failed sync. A scheduled source fires at most once per cron
 * occurrence (`lastScheduled`), disabled sources are not selected, and a queued run for a disabled source
 * is closed as DISABLED by syncSource without calling the scraper. A crash in one sync is logged and the
 * tick moves on; the next tick starts from the database state, where a login failure has already
 * disabled the source.
 */
import { schema } from '@pinkas/db';
import { Cron } from 'croner';
import { and, asc, eq } from 'drizzle-orm';
import { syncSource, type SyncDeps } from './sync-source.js';

export const DEFAULT_CRON = '30 6 * * *';
export const TICK_MS = 15_000;
/** A cron occurrence stays due for a few ticks so a busy worker does not miss it. */
export const DUE_WINDOW_MS = 4 * TICK_MS;

export interface TickState {
  /** sourceId → ISO time of the cron occurrence already handled. */
  lastScheduled: Map<string, string>;
}

export function newTickState(): TickState {
  return { lastScheduled: new Map() };
}

export async function runTick(
  deps: SyncDeps,
  state: TickState,
  now: Date = new Date(),
): Promise<{ manual: number; scheduled: number }> {
  const { db, log } = deps;
  let manual = 0;
  let scheduled = 0;

  const queued = await db
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.status, 'queued'))
    .orderBy(asc(schema.syncRuns.startedAt));
  for (const run of queued) {
    manual++;
    await syncSource(deps, run.sourceId, 'manual', run.id).catch((err: unknown) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'manual sync crashed');
    });
  }

  const sources = await db
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.kind, 'scraper'), eq(schema.sources.enabled, true)));
  for (const s of sources) {
    const expr = s.scheduleCron ?? DEFAULT_CRON;
    let occurrence: Date | null = null;
    try {
      // The first cron occurrence inside the due window (windowStart, now], if any.
      const windowStart = new Date(now.getTime() - DUE_WINDOW_MS);
      const next = new Cron(expr, { timezone: 'Asia/Jerusalem' }).nextRun(windowStart);
      if (next && next.getTime() <= now.getTime()) occurrence = next;
    } catch {
      log.warn({ sourceId: s.id, expr }, 'invalid cron expression');
    }
    if (!occurrence) continue;
    const key = occurrence.toISOString();
    if (state.lastScheduled.get(s.id) === key) continue; // once per occurrence
    state.lastScheduled.set(s.id, key);
    scheduled++;
    await syncSource(deps, s.id, 'schedule').catch((err: unknown) => {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'scheduled sync crashed',
      );
    });
  }
  return { manual, scheduled };
}
