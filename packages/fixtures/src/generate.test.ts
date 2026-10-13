import { daysBetween, monthOf, normalizeMerchant } from '@pinkas/domain';
import { UNCATEGORIZED_SLUG, seedRules } from '@pinkas/shared';
import { describe, expect, it } from 'vitest';
import { isCounted } from './expectations.js';
import { CAL_ID, CHECKING_ID, MAX_ID, SAVINGS_ID, generateHousehold } from './generate.js';
import type { FixtureTxn } from './types.js';

const OPTS = { seed: 42, endMonth: '2026-10', months: 12 };
const h = generateHousehold(OPTS);
const cardIds = new Set([MAX_ID, CAL_ID]);
const cardRows = h.transactions.filter((t) => cardIds.has(t.accountId));
const matchesSeedRule = (t: FixtureTxn): boolean => {
  const merchant = normalizeMerchant(t.descriptionRaw);
  return seedRules.some((r) => merchant.includes(r.pattern.toLowerCase()));
};

describe('generateHousehold', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(generateHousehold(OPTS)).toEqual(h);
    expect(generateHousehold({ ...OPTS, seed: 7 }).transactions).not.toEqual(h.transactions);
  });

  it('has the expected accounts and 12 months of expectations', () => {
    expect(h.accounts.map((a) => a.id)).toEqual([CHECKING_ID, SAVINGS_ID, MAX_ID, CAL_ID]);
    expect(h.expectations.map((e) => e.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(h.transactions.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.txnDate))).toBe(true);
  });

  it('sets identifiers on bank rows only and processedDate on card rows only', () => {
    const bankRows = h.transactions.filter((t) => !cardIds.has(t.accountId));
    const ids = bankRows.map((t) => t.externalIdentifier);
    expect(ids.every((id) => id !== undefined && /^\d+$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bankRows.every((t) => t.processedDate === undefined)).toBe(true);
    expect(
      cardRows.every((t) => t.externalIdentifier === undefined && t.processedDate !== undefined),
    ).toBe(true);
  });

  it('generates 80–150 card purchases per month', () => {
    for (const e of h.expectations) {
      const n = cardRows.filter(
        (t) => t.tag === 'card_purchase' && monthOf(t.txnDate) === e.month,
      ).length;
      expect(n).toBeGreaterThanOrEqual(80);
      expect(n).toBeLessThanOrEqual(152);
    }
  });

  it('settles every card cycle on checking with the exact sum of its card rows', () => {
    const settlements = h.transactions.filter((t) => t.tag === 'card_settlement');
    expect(settlements.length).toBe(22);
    for (const s of settlements) {
      const [, accountId, cycleMonth] = s.counterpartKey!.split(':');
      const cycle = cardRows.filter(
        (t) => t.accountId === accountId && t.processedDate === s.txnDate,
      );
      expect(cycle.length).toBeGreaterThan(0);
      expect(cycle.every((t) => monthOf(t.txnDate) === cycleMonth)).toBe(true);
      expect(s.accountId).toBe(CHECKING_ID);
      expect(s.chargedAmountAgorot).toBe(cycle.reduce((acc, t) => acc + t.chargedAmountAgorot, 0));
    }
    const chargeDates = new Set(
      cardRows
        .filter((t) => t.processedDate! <= '2026-10-31')
        .map((t) => `${t.accountId}|${t.processedDate}`),
    );
    expect(chargeDates.size).toBe(settlements.length);
  });

  it('excludes settlement and transfer rows from expectations', () => {
    for (const e of h.expectations) {
      const rows = h.transactions.filter((t) => monthOf(t.txnDate) === e.month);
      const counted = rows.filter(isCounted);
      expect(rows.some((t) => !isCounted(t))).toBe(true);
      expect(Object.keys(e.byCategory).some((slug) => slug.startsWith('transfer'))).toBe(false);
      const signedTotal = Object.values(e.byCategory).reduce((a, b) => a + b, 0);
      expect(signedTotal).toBe(counted.reduce((a, t) => a + t.chargedAmountAgorot, 0));
      expect(e.netAgorot).toBe(e.incomeAgorot - e.expensesAgorot);
      expect(e.fixedAgorot + e.variableAgorot).toBe(e.expensesAgorot);
      expect(e.incomeAgorot).toBe(
        counted.filter((t) => t.tag === 'income').reduce((a, t) => a + t.chargedAmountAgorot, 0),
      );
      for (const v of Object.values(e))
        if (typeof v === 'number') expect(Number.isSafeInteger(v)).toBe(true);
    }
    expect(h.expectations.some((e) => e.incomeAgorot === 0)).toBe(true);
  });

  it('models transfers as excluded pairs with equal amounts', () => {
    const transfers = h.transactions.filter((t) => t.tag === 'transfer');
    expect(transfers.length).toBe(8);
    for (let k = 0; k < 4; k++) {
      const legs = transfers.filter((t) => t.counterpartKey === `xfer-${k}`);
      const out = legs.find((t) => t.accountId === CHECKING_ID)!;
      const inn = legs.find((t) => t.accountId === SAVINGS_ID)!;
      expect(out.chargedAmountAgorot).toBe(-inn.chargedAmountAgorot);
      expect(daysBetween(out.txnDate, inn.txnDate)).toBeLessThanOrEqual(2);
      expect(legs.every((t) => t.expectedCategorySlug === 'transfer.own')).toBe(true);
    }
  });

  it('refunds a smaller-or-equal amount at the same merchant 5–40 days later, once across a month', () => {
    const refunds = h.transactions.filter((t) => t.tag === 'refund');
    expect(refunds.length).toBe(3);
    const crossesMonth: boolean[] = [];
    for (const r of refunds) {
      const original = h.transactions.find(
        (t) => t.counterpartKey === r.counterpartKey && t.tag === 'card_purchase',
      )!;
      expect(r.accountId).toBe(original.accountId);
      expect(r.descriptionRaw).toBe(original.descriptionRaw);
      expect(r.expectedCategorySlug).toBe(original.expectedCategorySlug);
      expect(r.chargedAmountAgorot).toBeGreaterThan(0);
      expect(r.chargedAmountAgorot).toBeLessThanOrEqual(-original.chargedAmountAgorot);
      const gap = daysBetween(original.txnDate, r.txnDate);
      expect(gap).toBeGreaterThanOrEqual(5);
      expect(gap).toBeLessThanOrEqual(40);
      crossesMonth.push(monthOf(original.txnDate) !== monthOf(r.txnDate));
    }
    expect(crossesMonth).toContain(true);
  });

  it('splits two purchases into installments spanning a year boundary', () => {
    const groups = new Map<string, FixtureTxn[]>();
    for (const t of h.transactions.filter((t) => t.tag === 'installment')) {
      groups.set(t.counterpartKey!, [...(groups.get(t.counterpartKey!) ?? []), t]);
    }
    expect([...groups.keys()]).toEqual(['inst-0', 'inst-1']);
    const [a, b] = [groups.get('inst-0')!, groups.get('inst-1')!];
    expect(a.map((t) => t.installmentNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(
      a.every((t) => t.installmentTotal === 12 && t.descriptionRaw === a[0]!.descriptionRaw),
    ).toBe(true);
    expect(a.reduce((acc, t) => acc + t.chargedAmountAgorot, 0)).toBe(-478_800);
    expect(a.map((t) => monthOf(t.txnDate))).toEqual(h.expectations.map((e) => e.month));
    expect(b.map((t) => t.installmentNumber)).toEqual([1, 2, 3, 4]);
    expect(b.every((t) => t.installmentTotal === 6)).toBe(true);
    const months = a.map((t) => monthOf(t.txnDate));
    expect(months).toContain('2025-12');
    expect(months).toContain('2026-01');
  });

  it('keeps ≥10% of card merchants unknown to seed rules and ≥70% known, matching the ground truth', () => {
    const purchases = cardRows.filter((t) => t.tag !== 'refund');
    const known = purchases.filter(matchesSeedRule);
    expect(known.length / purchases.length).toBeGreaterThanOrEqual(0.7);
    expect(1 - known.length / purchases.length).toBeGreaterThanOrEqual(0.1);
    for (const t of purchases)
      expect(matchesSeedRule(t)).toBe(t.expectedCategorySlug !== UNCATEGORIZED_SLUG);
  });

  it('includes messy descriptions', () => {
    const descs = cardRows.map((t) => t.descriptionRaw);
    expect(descs.some((d) => d.includes('\u200f'))).toBe(true);
    expect(descs.some((d) => /\s{2}/.test(d))).toBe(true);
    expect(descs.some((d) => d.includes('סניף'))).toBe(true);
    expect(descs.some((d) => /\d{4}$/.test(d))).toBe(true);
    expect(descs.some((d) => d.includes('🛒'))).toBe(true);
    expect(descs.some((d) => /[a-z]/.test(d) && /[A-Z]/.test(d))).toBe(true);
  });

  it('marks the last 3 card purchases of the final month pending', () => {
    const pending = h.transactions.filter((t) => t.status === 'pending');
    expect(pending.length).toBe(3);
    expect(
      pending.every((t) => t.tag === 'card_purchase' && monthOf(t.txnDate) === '2026-10'),
    ).toBe(true);
    const lastDate = cardRows.filter((t) => t.tag === 'card_purchase').at(-1)!.txnDate;
    expect(pending.every((t) => t.txnDate <= lastDate)).toBe(true);
  });

  it('has FX purchases with an adjustment row and two identical counted purchases', () => {
    const fx = h.transactions.filter((t) => t.tag === 'fx');
    expect(
      fx.filter((t) => t.originalCurrency !== undefined).map((t) => t.originalCurrency),
    ).toEqual(['USD', 'EUR']);
    expect(fx.filter((t) => t.memo === 'הפרשי שער').length).toBe(2);
    for (const adj of fx.filter((t) => t.memo !== undefined)) {
      const original = fx.find(
        (t) => t.counterpartKey === adj.counterpartKey && t.memo === undefined,
      )!;
      expect(daysBetween(original.txnDate, adj.txnDate)).toBe(3);
      expect(adj.descriptionRaw).toBe(original.descriptionRaw);
      expect(original.originalAmountMinor).toBeLessThan(0);
    }
    const twins = cardRows.filter(
      (t) =>
        t.descriptionRaw === 'WOLT' &&
        t.chargedAmountAgorot === -6490 &&
        t.txnDate === '2026-02-07',
    );
    expect(twins.length).toBe(2);
    expect(twins.every(isCounted)).toBe(true);
  });

  it('generates fixed bills on checking every month', () => {
    for (const e of h.expectations) {
      const rows = h.transactions.filter(
        (t) => t.accountId === CHECKING_ID && monthOf(t.txnDate) === e.month,
      );
      const slugs = rows.map((t) => t.expectedCategorySlug);
      for (const slug of [
        'housing.rent',
        'utilities.phone',
        'utilities.internet',
        'health.insurance',
        'finance.fees',
      ])
        expect(slugs).toContain(slug);
      expect(slugs.includes('housing.arnona') !== slugs.includes('utilities.electricity')).toBe(
        true,
      );
      expect(rows.find((t) => t.tag === 'rent')!.chargedAmountAgorot).toBe(-520_000);
    }
  });

  it('supports short windows and other end months', () => {
    const small = generateHousehold({ seed: 1, months: 2, endMonth: '2026-06' });
    expect(small.expectations.map((e) => e.month)).toEqual(['2026-05', '2026-06']);
    expect(
      small.transactions.every((t) => t.txnDate >= '2026-05-01' && t.txnDate <= '2026-06-30'),
    ).toBe(true);
  });
});
