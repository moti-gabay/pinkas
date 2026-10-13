/** Test/e2e stand-in for the real scraper: returns fixture results, or a chosen error type. Never used in production. */
import { generateHousehold, toScraperResult, CAL_ID, CHECKING_ID, MAX_ID } from '@pinkas/fixtures';
import type { ScrapeFn } from './run-scrape.js';

const byCompany: Record<string, string> = { beinleumi: CHECKING_ID, max: MAX_ID, visaCal: CAL_ID };

export const mockScrape: ScrapeFn = async (opts, credentials) => {
  const fail = credentials['password']?.startsWith('fail:')
    ? credentials['password'].slice(5)
    : undefined;
  if (fail) return { success: false, errorType: fail as never, errorMessage: `mock ${fail}` };
  const fixtureAccount = byCompany[opts.companyId];
  if (!fixtureAccount)
    return {
      success: false,
      errorType: 'GENERAL_ERROR' as never,
      errorMessage: 'unsupported in mock',
    };
  const h = generateHousehold({ months: 3, seed: 42, endMonth: '2026-03' });
  return toScraperResult(h, fixtureAccount) as never;
};
