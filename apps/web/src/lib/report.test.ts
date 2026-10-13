import { describe, expect, it } from 'vitest';
import { deltaPercent, rollupExpenses } from './report';

describe('deltaPercent', () => {
  it('returns a signed ratio against the absolute baseline', () => {
    expect(deltaPercent(110, 100)).toBeCloseTo(0.1);
    expect(deltaPercent(90, 100)).toBeCloseTo(-0.1);
    expect(deltaPercent(-50, -100)).toBeCloseTo(0.5);
  });

  it('returns null without a baseline', () => {
    expect(deltaPercent(100, 0)).toBeNull();
    expect(deltaPercent(100, null)).toBeNull();
    expect(deltaPercent(100, undefined)).toBeNull();
  });
});

describe('rollupExpenses', () => {
  const food = 'a0000000-0000-4000-8000-000000000001';
  const groceries = 'a0000000-0000-4000-8000-000000000002';
  const restaurants = 'a0000000-0000-4000-8000-000000000003';
  const housing = 'a0000000-0000-4000-8000-000000000004';
  const categories = [
    { id: food, nameHe: 'מזון' },
    { id: groceries, nameHe: 'סופרמרקט' },
    { id: restaurants, nameHe: 'מסעדות' },
    { id: housing, nameHe: 'דיור' },
  ];
  const row = (
    categoryId: string,
    parentId: string | null,
    amountAgorot: number,
    kind: 'expense' | 'income' | 'transfer' = 'expense',
  ) => ({
    categoryId,
    slug: categoryId,
    nameHe: categories.find((c) => c.id === categoryId)?.nameHe ?? '?',
    parentId,
    kind,
    amountAgorot,
    txnCount: 1,
  });

  it('rolls children into parents, ignores income, sorts by amount and computes shares', () => {
    const out = rollupExpenses(
      [
        row(groceries, food, -30_000),
        row(restaurants, food, -10_000),
        row(housing, null, -60_000),
        row(food, null, 50_000, 'income'),
      ],
      categories,
    );
    expect(out.map((c) => [c.nameHe, c.amountAgorot, c.txnCount])).toEqual([
      ['דיור', 60_000, 1],
      ['מזון', 40_000, 2],
    ]);
    expect(out[0]?.share).toBeCloseTo(0.6);
    expect(out[1]?.share).toBeCloseTo(0.4);
  });

  it('drops categories with net refunds', () => {
    expect(rollupExpenses([row(housing, null, 5_000)], categories)).toEqual([]);
  });
});
