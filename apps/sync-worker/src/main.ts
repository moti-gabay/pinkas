/**
 * Worker loop: every tick, claim queued manual runs and fire scheduled sources whose cron is due.
 * One scrape at a time (one Chromium). A failed login never schedules a retry.
 */
import { createDb, createPool, schema } from '@pinkas/db';
import { Cron } from 'croner';
import { and, asc, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { config } from './config.js';
import { loadKeypair } from './credentials/open.js';
import { syncSource, type SyncDeps } from './pipeline/sync-source.js';
import { mockScrape } from './scrapers/mock-scrape.js';
import { scrape } from './scrapers/run-scrape.js';

const log = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      '*.password',
      'username',
      '*.username',
      'card6Digits',
      '*.card6Digits',
      'credentials',
      '*.credentials',
    ],
    censor: '[REDACTED]',
  },
});
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
const deps: SyncDeps = {
  db,
  scrape: config.SCRAPER_MOCK === '1' ? mockScrape : scrape,
  keypair: await loadKeypair(config.CREDENTIALS_PRIVATE_KEY_FILE),
  log,
  executablePath: config.CHROMIUM_PATH,
  timeoutMs: config.SCRAPE_TIMEOUT_MS,
  historyMonths: config.HISTORY_MONTHS,
  proxyUrl: config.EGRESS_PROXY_URL,
};
if (config.SCRAPER_MOCK === '1')
  log.warn('SCRAPER_MOCK=1: using fixture data instead of real banks');

let busy = false;
const lastScheduled = new Map<string, string>(); // sourceId → ISO minute of the last scheduled fire

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    // 1. manual requests
    const queued = await db
      .select()
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.status, 'queued'))
      .orderBy(asc(schema.syncRuns.startedAt));
    for (const run of queued) {
      await syncSource(deps, run.sourceId, 'manual', run.id).catch((err: unknown) => {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'manual sync crashed');
      });
    }
    // 2. schedules (default: daily 06:30)
    const sources = await db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.kind, 'scraper'), eq(schema.sources.enabled, true)));
    const now = new Date();
    for (const s of sources) {
      const expr = s.scheduleCron ?? '30 6 * * *';
      let due = false;
      try {
        const prev = new Cron(expr, { timezone: 'Asia/Jerusalem' }).previousRun();
        if (prev) {
          due =
            now.getTime() - prev.getTime() < 60_000 &&
            lastScheduled.get(s.id) !== prev.toISOString();
          if (due) lastScheduled.set(s.id, prev.toISOString());
        }
      } catch {
        log.warn({ sourceId: s.id, expr }, 'invalid cron expression');
      }
      if (due)
        await syncSource(deps, s.id, 'schedule').catch((err: unknown) => {
          log.error(
            { err: err instanceof Error ? err.message : String(err) },
            'scheduled sync crashed',
          );
        });
    }
  } finally {
    busy = false;
  }
}

log.info(
  { historyMonths: config.HISTORY_MONTHS, mock: config.SCRAPER_MOCK },
  'sync-worker started',
);
setInterval(() => void tick(), 15_000);
void tick();
