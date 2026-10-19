/**
 * Worker loop: every tick, claim queued manual runs and fire scheduled sources whose cron is due.
 * One scrape at a time (one Chromium). A failed login never schedules a retry.
 */
import { writeFileSync } from 'node:fs';
import { createDb, createPool } from '@pinkas/db';
import { pino } from 'pino';
import { config } from './config.js';
import { loadKeypair } from './credentials/open.js';
import type { SyncDeps } from './pipeline/sync-source.js';
import { TICK_MS, newTickState, runTick } from './pipeline/tick.js';
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
const state = newTickState();

/** Liveness for the compose healthcheck: touched after every completed tick, and while a scrape is running. */
const beat = () => {
  writeFileSync(config.HEARTBEAT_FILE, new Date().toISOString());
};

async function tick(): Promise<void> {
  if (busy) {
    beat(); // one scrape at a time; a long scrape is still alive
    return;
  }
  busy = true;
  try {
    await runTick(deps, state);
    beat(); // only after the database answered, so a lost DB turns the container unhealthy
  } finally {
    busy = false;
  }
}

log.info(
  { historyMonths: config.HISTORY_MONTHS, mock: config.SCRAPER_MOCK },
  'sync-worker started',
);
const safeTick = () => {
  tick().catch((err: unknown) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'tick failed');
  });
};
setInterval(safeTick, TICK_MS);
safeTick();
