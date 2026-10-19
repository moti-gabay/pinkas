import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  assertIsoDate,
  assertIsoMonth,
  compareDates,
  dayOfMonth,
  daysBetween,
  daysInMonth,
  instantToIsoDate,
  monthOf,
  monthRange,
  parseLooseDate,
  todayInJerusalem,
} from './dates.js';

describe('validation', () => {
  it('accepts real calendar dates and months only', () => {
    expect(assertIsoDate('2028-02-29')).toBe('2028-02-29');
    expect(() => assertIsoDate('2026-02-29')).toThrow(); // not a leap year
    expect(() => assertIsoDate('2026-02-30')).toThrow();
    expect(() => assertIsoDate('07/03/2026')).toThrow(RangeError);
    expect(assertIsoMonth('2026-12')).toBe('2026-12');
    expect(() => assertIsoMonth('2026-13')).toThrow();
    expect(() => assertIsoMonth('2026-3')).toThrow(RangeError);
  });
});

describe('todayInJerusalem', () => {
  it('uses the Israeli civil day, not the UTC one', () => {
    expect(todayInJerusalem(() => '2026-06-30T21:30:00Z')).toBe('2026-07-01'); // 00:30 IDT
    expect(todayInJerusalem(() => '2026-06-30T20:30:00Z')).toBe('2026-06-30');
    expect(todayInJerusalem()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('day math', () => {
  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('reads month lengths, day of month and order', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(dayOfMonth('2026-03-07')).toBe(7);
    expect(monthOf('2026-03-07')).toBe('2026-03');
    expect(compareDates('2026-03-07', '2026-03-08')).toBe(-1);
    expect(compareDates('2026-03-08', '2026-03-07')).toBe(1);
    expect(compareDates('2026-03-07', '2026-03-07')).toBe(0);
  });
});

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
    [46088.75, '2026-03-07'], // Excel serial with a time fraction
    [1500, undefined], // too small to be a plausible statement date
    [99999, undefined],
    [Number.NaN, undefined],
    ['  07/03/2026‏ ', '2026-03-07'], // RLM and padding from Hebrew exports
  ])('%s → %s', (input, expected) => {
    expect(parseLooseDate(input)).toBe(expected);
  });
});
