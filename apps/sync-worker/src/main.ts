import { pino } from 'pino';
import { config } from './config.js';

const logger = pino({ level: config.LOG_LEVEL });
logger.info(
  { historyMonths: config.HISTORY_MONTHS },
  'sync-worker starting (phase 2 will add scheduling)',
);
// Keep the container alive until the scheduler lands in phase 2.
setInterval(() => undefined, 60_000);
