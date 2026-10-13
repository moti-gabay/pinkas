import { describe, expect, it } from 'vitest';
import { maskDigits } from './redact.js';

describe('maskDigits', () => {
  it('masks runs of 6+ digits to last 4', () => {
    expect(maskDigits('acct 123456789 ok')).toBe('acct *****6789 ok');
  });
  it('leaves short numbers (amounts, dates) alone', () => {
    expect(maskDigits('12345 and 2026')).toBe('12345 and 2026');
  });
});
