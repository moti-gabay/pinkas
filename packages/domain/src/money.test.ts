import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDecimalToMinor, percentOf, sum } from './money.js';

describe('parseDecimalToMinor', () => {
  it.each([
    ['1,234.56', 123456],
    ['1234.5', 123450],
    ['-12.30', -1230],
    ['12.30-', -1230],
    ['(12.30)', -1230],
    ['₪ 1,234.00', 123400],
    ['1.234,56', 123456],
    ['1,234', 123400],
    ['12', 1200],
    ['0.01', 1],
    ['\u200f-150.00\u200e', -15000],
    ['12.500', 1250],
  ])('parses %s → %d', (input, expected) => {
    expect(parseDecimalToMinor(input)).toBe(expected);
  });
  it('parses numbers from spreadsheet cells exactly', () => {
    expect(parseDecimalToMinor(0.1 + 0.2)).toBe(30);
    expect(parseDecimalToMinor(1234.565)).toBe(123457);
  });
  it('rejects garbage and over-precision', () => {
    expect(() => parseDecimalToMinor('abc')).toThrow(RangeError);
    expect(() => parseDecimalToMinor('12.345')).toThrow(RangeError);
    expect(() => parseDecimalToMinor('')).toThrow(RangeError);
  });
  it('round-trips any integer agorot through a decimal string', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000_00, max: 1_000_000_000_00 }), (agorot) => {
        const s = `${agorot < 0 ? '-' : ''}${Math.floor(Math.abs(agorot) / 100)}.${String(Math.abs(agorot) % 100).padStart(2, '0')}`;
        expect(parseDecimalToMinor(s)).toBe(agorot);
      }),
    );
  });
});

describe('sum / percentOf', () => {
  it('sums exactly', () => {
    expect(sum([1, 2, -3, 100])).toBe(100);
  });
  it('rejects floats', () => {
    expect(() => sum([1.5])).toThrow(RangeError);
  });
  it('rounds half away from zero', () => {
    expect(percentOf(1000, 17)).toBe(170);
    expect(percentOf(1001, 17)).toBe(170);
    expect(percentOf(-1001, 17)).toBe(-170);
    expect(percentOf(15, 10)).toBe(2);
  });
});
