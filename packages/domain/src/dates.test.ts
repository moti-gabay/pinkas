import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, instantToIsoDate, monthRange, parseLooseDate } from './dates.js';

describe('instantToIsoDate (Asia/Jerusalem)', () => {
  it('maps late-UTC instants to the next civil day in Israel', () => {
    expect(instantToIsoDate('2026-03-31T22:30:00Z')).toBe('2026-04-01'); // IDT (+3)
    expect(instantToIsoDate('2026-01-31T21:30:00Z')).toBe('2026-01-31'); // IST (+2) → 23:30
    expect(instantToIsoDate('2026-01-31T22:30:00Z')).toBe('2026-02-01');
  });
  it('handles DST transitions', () => {
    // Israel moves to IDT on 2026-03-27 02:00. 2026-03-26T23:30Z is 01:30 IST → 26th? no: 23:30Z + 2h = 01:30 on the 27th.
    expect(instantToIsoDate('2026-03-26T23:30:00Z')).toBe('2026-03-27');
    // After switch: 2026-10-24T21:30Z: IDT ends 2026-10-25 02:00; at this instant +3 → 00:30 on the 25th.
    expect(instantToIsoDate('2026-10-24T21:30:00Z')).toBe('2026-10-25');
  });
  it('keeps scraper midnight-local strings on their day', () => {
    expect(instantToIsoDate('2026-05-10T00:00:00+03:00')).toBe('2026-05-10');
  });
});

describe('month math', () => {
  it('ranges and adds across years', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02').to).toBe('2028-02-29');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(daysBetween('2026-01-31', '2026-02-02')).toBe(2);
  });
});

describe('parseLooseDate', () => {
  it.each([
    ['07/03/2026', '2026-03-07'],
    ['7.3.26', '2026-03-07'],
    ['2026-03-07', '2026-03-07'],
    ['2026-03-07T10:00:00.000Z', '2026-03-07'],
    ['31/02/2026', undefined],
    ['hello', undefined],
    [46088, '2026-03-07'],
  ])('%s → %s', (input, expected) => {
    expect(parseLooseDate(input)).toBe(expected);
  });
});
