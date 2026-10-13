import { describe, expect, it } from 'vitest';
import { formatAgorot, formatDate, formatMonth } from './format.js';

const strip = (s: string) => s.replace(/[‎ ]/g, ' ').trim();

describe('formatAgorot', () => {
  it('formats agorot as ILS with two decimals', () => {
    expect(strip(formatAgorot(123456))).toContain('1,234.56');
    expect(strip(formatAgorot(123456))).toContain('₪');
  });
  it('keeps sign for outflows', () => {
    expect(strip(formatAgorot(-5000))).toMatch(/-.*50\.00|50\.00.*-/);
  });
  it('rejects non-integers', () => {
    expect(() => formatAgorot(1.5)).toThrow(RangeError);
  });
});

describe('dates', () => {
  it('formats DD/MM/YYYY', () => {
    expect(formatDate('2026-03-07')).toBe('07/03/2026');
  });
  it('formats Hebrew month names', () => {
    expect(formatMonth('2026-10')).toBe('אוקטובר 2026');
  });
  it('rejects bad input', () => {
    expect(() => formatDate('07/03/2026')).toThrow();
  });
});
