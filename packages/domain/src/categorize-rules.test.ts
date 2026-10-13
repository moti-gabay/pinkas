import { describe, expect, it } from 'vitest';
import {
  applyRules,
  proposeLearnedRule,
  sortRules,
  type CategoryRule,
} from './categorize-rules.js';

const rule = (over: Partial<CategoryRule>): CategoryRule => ({
  id: 'r',
  pattern: 'x',
  match: 'contains',
  field: 'merchant_normalized',
  categoryId: 'c',
  isFixed: undefined,
  priority: 100,
  accountScope: undefined,
  enabled: true,
  ...over,
});
const input = {
  accountId: 'a1',
  merchantNormalized: 'שופרסל דיל',
  descriptionRaw: 'שופרסל דיל סניף 12',
};

describe('applyRules', () => {
  it('first by priority, then longer pattern', () => {
    const rules = sortRules([
      rule({ id: 'seed', pattern: 'שופרסל', categoryId: 'food', priority: 100 }),
      rule({ id: 'user', pattern: 'שופרסל דיל', categoryId: 'food.groceries', priority: 10 }),
      rule({ id: 'disabled', pattern: 'שופרסל', categoryId: 'no', priority: 1, enabled: false }),
    ]);
    expect(applyRules(rules, input)?.rule.id).toBe('user');
    const same = sortRules([
      rule({ id: 'short', pattern: 'שופ' }),
      rule({ id: 'long', pattern: 'שופרסל ד' }),
    ]);
    expect(applyRules(same, input)?.rule.id).toBe('long');
  });
  it('supports exact, prefix, regex, account scope and invalid regex', () => {
    expect(applyRules([rule({ match: 'exact', pattern: 'שופרסל דיל' })], input)).toBeDefined();
    expect(applyRules([rule({ match: 'exact', pattern: 'שופרסל' })], input)).toBeUndefined();
    expect(applyRules([rule({ match: 'prefix', pattern: 'שופ' })], input)).toBeDefined();
    expect(applyRules([rule({ match: 'regex', pattern: '^שופרסל\\s+דיל$' })], input)).toBeDefined();
    expect(applyRules([rule({ match: 'regex', pattern: '(' })], input)).toBeUndefined();
    expect(applyRules([rule({ pattern: 'שופ', accountScope: 'other' })], input)).toBeUndefined();
    expect(
      applyRules([rule({ pattern: 'סניף 12', field: 'description_raw' })], input),
    ).toBeDefined();
    expect(applyRules([rule({ pattern: '' })], input)).toBeUndefined();
  });
  it('proposes an exact learned rule', () => {
    expect(proposeLearnedRule(input, 'food')).toEqual({
      pattern: 'שופרסל דיל',
      match: 'exact',
      field: 'merchant_normalized',
      categoryId: 'food',
    });
  });
});
