/**
 * THE ONLY place that touches israeli-bank-scrapers. It calls exactly one library operation,
 * `scrape`, which logs in and reads transactions. There is no code path for any write action.
 */
import {
  CompanyTypes,
  createScraper,
  type ScraperCredentials,
  type ScraperScrapingResult,
} from 'israeli-bank-scrapers';

export interface ScrapeOptions {
  companyId: string;
  startDate: Date;
  executablePath: string;
  timeoutMs: number;
  proxyUrl: string | undefined;
  showBrowser?: boolean;
}

export type ScrapeFn = (
  opts: ScrapeOptions,
  credentials: Record<string, string>,
) => Promise<ScraperScrapingResult>;

export const scrape: ScrapeFn = async (opts, credentials) => {
  if (!(opts.companyId in CompanyTypes)) throw new Error(`unsupported company ${opts.companyId}`);
  const companyId = CompanyTypes[opts.companyId as keyof typeof CompanyTypes];
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ];
  if (opts.proxyUrl) args.push(`--proxy-server=${opts.proxyUrl}`);
  const scraper = createScraper({
    companyId,
    startDate: opts.startDate,
    combineInstallments: false, // one row per charged installment (ADR 0003)
    showBrowser: opts.showBrowser ?? false,
    executablePath: opts.executablePath,
    args,
    timeout: opts.timeoutMs,
    defaultTimeout: opts.timeoutMs,
    verbose: false,
  });
  // The credential object is typed loosely by the library; we pass exactly the fields the user entered.
  return scraper.scrape(credentials as unknown as ScraperCredentials);
};
