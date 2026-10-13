import { generateHousehold, toScraperResult, CHECKING_ID, MAX_ID } from '@pinkas/fixtures';
import { describe, expect, it } from 'vitest';
import { mapResult, toMinor } from './map-result.js';

describe('mapResult', () => {
  const h = generateHousehold({ months: 3, seed: 3, endMonth: '2026-03' });
  it('maps synthetic scraper output back to the exact fixture rows', () => {
    for (const accountId of [CHECKING_ID, MAX_ID]) {
      const fixture = h.transactions.filter((t) => t.accountId === accountId);
      const [acc] = mapResult(toScraperResult(h, accountId) as never);
      expect(acc?.rows.length).toBe(fixture.length);
      acc?.rows.forEach((r, i) => {
        const f = fixture[i]!;
        expect(r.txnDate, f.descriptionRaw).toBe(f.txnDate);
        expect(r.chargedAmountAgorot).toBe(f.chargedAmountAgorot);
        expect(r.descriptionRaw).toBe(f.descriptionRaw);
        expect(r.status).toBe(f.status);
        expect(r.externalIdentifier).toBe(f.externalIdentifier);
        expect(r.installmentNumber).toBe(f.installmentNumber);
        if (f.originalCurrency) {
          expect(r.originalCurrency).toBe(f.originalCurrency);
          expect(r.originalAmountMinor).toBe(f.originalAmountMinor);
        }
      });
    }
  });
  it('rounds decimal amounts to minor units exactly', () => {
    expect(toMinor(-64.9, 'ILS')).toBe(-6490);
    expect(toMinor(0.1 + 0.2, 'ILS')).toBe(30);
    expect(toMinor(1500, 'JPY')).toBe(1500);
  });
  it('returns nothing for failed results', () => {
    expect(mapResult({ success: false, errorType: 'INVALID_PASSWORD' as never })).toEqual([]);
  });
});
