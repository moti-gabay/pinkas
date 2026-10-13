/**
 * One-off probe for a company that is not yet known to work (e.g. Pepper via `leumi`):
 *   PROBE_COMPANY=leumi PROBE_USERNAME=... PROBE_PASSWORD=... pnpm --filter @pinkas/sync-worker probe
 * Prints only success/errorType/account count. Never prints credentials or transactions.
 */
import { scrape } from './run-scrape.js';

const companyId = process.env['PROBE_COMPANY'];
const username = process.env['PROBE_USERNAME'];
const password = process.env['PROBE_PASSWORD'];
if (!companyId || !username || !password) {
  process.stderr.write('PROBE_COMPANY, PROBE_USERNAME and PROBE_PASSWORD are required\n');
  process.exit(2);
}
const result = await scrape(
  {
    companyId,
    startDate: new Date(Date.now() - 30 * 86_400_000),
    executablePath: process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium',
    timeoutMs: 120_000,
    proxyUrl: undefined,
    showBrowser: process.env['PROBE_SHOW'] === '1',
  },
  { username, password },
);
process.stdout.write(
  `${JSON.stringify({ success: result.success, errorType: result.errorType, accounts: result.accounts?.length ?? 0, txns: result.accounts?.reduce((n, a) => n + a.txns.length, 0) ?? 0 })}\n`,
);
