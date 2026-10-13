/**
 * Scraper companies we support and their login fields. Copied (not imported) from
 * israeli-bank-scrapers' SCRAPERS definitions so that api/web never depend on the library.
 * Verified against v6.12.2.
 */
export const supportedCompanies = {
  beinleumi: { nameHe: 'הבנק הבינלאומי', kind: 'bank', loginFields: ['username', 'password'] },
  leumi: { nameHe: 'בנק לאומי', kind: 'bank', loginFields: ['username', 'password'] },
  max: { nameHe: 'מקס', kind: 'card', loginFields: ['username', 'password'] },
  visaCal: { nameHe: 'כאל', kind: 'card', loginFields: ['username', 'password'] },
  isracard: { nameHe: 'ישראכרט', kind: 'card', loginFields: ['id', 'card6Digits', 'password'] },
} as const;

export type CompanyId = keyof typeof supportedCompanies;
export const companyIds = Object.keys(supportedCompanies) as CompanyId[];

export type LoginField = 'username' | 'password' | 'id' | 'card6Digits';

export const loginFieldLabelsHe: Record<LoginField, string> = {
  username: 'שם משתמש',
  password: 'סיסמה',
  id: 'תעודת זהות',
  card6Digits: '6 ספרות אחרונות של הכרטיס',
};

/** Mirrors ScraperErrorTypes in israeli-bank-scrapers v6.12.2. */
export const scraperErrorTypes = [
  'INVALID_PASSWORD',
  'CHANGE_PASSWORD',
  'ACCOUNT_BLOCKED',
  'TIMEOUT',
  'TWO_FACTOR_RETRIEVER_MISSING',
  'GENERIC',
  'GENERAL_ERROR',
] as const;
export type ScraperErrorType = (typeof scraperErrorTypes)[number];

/** Login-class failures: never retried; the source is disabled until credentials are re-entered. */
export const loginClassErrors: ReadonlySet<ScraperErrorType> = new Set([
  'INVALID_PASSWORD',
  'CHANGE_PASSWORD',
  'ACCOUNT_BLOCKED',
  'TWO_FACTOR_RETRIEVER_MISSING',
]);
