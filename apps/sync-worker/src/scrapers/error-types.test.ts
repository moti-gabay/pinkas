/** Our mirror of the library's error types must not drift on upgrade, or a new login-class error could slip past. */
import { loginClassErrors, scraperErrorTypes } from '@pinkas/shared';
import { ScraperErrorTypes } from 'israeli-bank-scrapers/lib/scrapers/errors.js';
import { describe, expect, it } from 'vitest';

describe('scraper error types', () => {
  it('scraperErrorTypes mirrors the library enum exactly', () => {
    expect([...scraperErrorTypes].sort()).toEqual(Object.values(ScraperErrorTypes).sort());
  });
  it('the login-class set is the one the no-retry rule relies on', () => {
    expect([...loginClassErrors].sort()).toEqual([
      'ACCOUNT_BLOCKED',
      'CHANGE_PASSWORD',
      'INVALID_PASSWORD',
      'TWO_FACTOR_RETRIEVER_MISSING',
    ]);
  });
});
