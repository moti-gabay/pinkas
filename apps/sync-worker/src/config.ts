import { commonEnv, databaseUrlEnv, loadEnv } from '@pinkas/shared';
import { z } from 'zod';

export const config = loadEnv({
  ...commonEnv,
  ...databaseUrlEnv,
  /** Path to the X25519 private key file (mounted read-only). Only this process can decrypt credentials. */
  CREDENTIALS_PRIVATE_KEY_FILE: z.string().default('/run/secrets/worker.key'),
  CHROMIUM_PATH: z.string().default('/usr/bin/chromium'),
  SCRAPE_TIMEOUT_MS: z.coerce.number().int().default(120_000),
  HISTORY_MONTHS: z.coerce.number().int().min(1).max(48).default(12),
  /** When set, scrapers are replaced by fixture results (tests / e2e). Never set in production. */
  SCRAPER_MOCK: z.enum(['0', '1']).default('0'),
  EGRESS_PROXY_URL: z.url().optional(),
});
