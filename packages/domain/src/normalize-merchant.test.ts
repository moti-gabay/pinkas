import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from './normalize-merchant.js';

describe('normalizeMerchant', () => {
  it.each([
    ['שופרסל דיל  סניף רמת גן', 'שופרסל דיל'],
    ['\u200fשופרסל דיל 1234', 'שופרסל דיל'],
    ['WOLT  *Tel Aviv', 'wolt tel aviv'],
    ['Netflix.com', 'netflix.com'],
    ['פז  -  ת"א 345', 'פז'],
    ['חיוב - רמי לוי בע"מ', 'רמי לוי'],
    ['PAYBOX - דני כהן', 'דני כהן'],
    ['  ', ''],
    ['😀 Cafe 42', '😀 cafe'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeMerchant(input)).toBe(expected);
  });
  it('is idempotent', () => {
    for (const s of ['שופרסל דיל סניף חיפה 12', 'Amazon.com*1234', 'bit - משה']) {
      expect(normalizeMerchant(normalizeMerchant(s))).toBe(normalizeMerchant(s));
    }
  });
});
