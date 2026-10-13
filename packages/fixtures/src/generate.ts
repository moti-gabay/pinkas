import {
  addDays,
  addMonths,
  compareDates,
  daysInMonth,
  monthOf,
  monthRange,
  sum,
  todayInJerusalem,
} from '@pinkas/domain';
import type { IsoDate, IsoMonth } from '@pinkas/domain';
import { UNCATEGORIZED_SLUG } from '@pinkas/shared';
import { computeExpectations } from './expectations.js';
import {
  decorateDescription,
  incomePayers,
  knownMerchants,
  subscriptions,
  unknownMerchants,
} from './merchants.js';
import type { Merchant } from './merchants.js';
import { Rng } from './prng.js';
import type {
  FixtureAccount,
  FixtureTag,
  FixtureTxn,
  GenerateOptions,
  Household,
} from './types.js';

export const CHECKING_ID = 'acc-checking';
export const SAVINGS_ID = 'acc-savings';
export const MAX_ID = 'acc-max';
export const CAL_ID = 'acc-cal';

const accounts: readonly FixtureAccount[] = [
  {
    id: CHECKING_ID,
    type: 'checking',
    companyId: 'beinleumi',
    externalId: '12-345-671234',
    displayName: 'עו"ש בינלאומי',
  },
  {
    id: SAVINGS_ID,
    type: 'checking',
    companyId: 'beinleumi',
    externalId: '12-345-675678',
    displayName: 'חיסכון',
  },
  {
    id: MAX_ID,
    type: 'credit_card',
    companyId: 'max',
    externalId: '4580',
    displayName: 'מקס 4580',
    cardCycleDay: 10,
  },
  {
    id: CAL_ID,
    type: 'credit_card',
    companyId: 'visaCal',
    externalId: '7731',
    displayName: 'כאל 7731',
    cardCycleDay: 2,
  },
];

const cycleDay: Record<string, number> = { [MAX_ID]: 10, [CAL_ID]: 2 };
const settlementDescription: Record<string, string> = {
  [MAX_ID]: 'מקס איט פיננסים בע"מ',
  [CAL_ID]: 'כרטיסי אשראי לישראל',
};

interface RowInput {
  accountId: string;
  txnDate: IsoDate;
  amount: number;
  description: string;
  slug: string;
  tag: FixtureTag;
  isFixed?: boolean;
  memo?: string;
  counterpartKey?: string;
  installment?: { number: number; total: number };
  fx?: { currency: string; originalMinor: number };
}

/** Civil date in `month`, clamping the day to the month's length. */
function dateIn(month: IsoMonth, day: number): IsoDate {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;
}

/** Card purchases made in month M are charged on the cycle day of M+1; that is the row's processedDate. */
function cycleChargeDate(accountId: string, txnDate: IsoDate): IsoDate {
  return dateIn(addMonths(monthOf(txnDate), 1), cycleDay[accountId] ?? 10);
}

class Builder {
  readonly rows: FixtureTxn[] = [];
  private nextAsmachta: number;

  constructor(seed: number) {
    this.nextAsmachta = 10_000_000 + (seed % 1000) * 10_000;
  }

  add(input: RowInput): FixtureTxn {
    const isCard = input.accountId === MAX_ID || input.accountId === CAL_ID;
    const row: FixtureTxn = {
      accountId: input.accountId,
      origin: 'scraper',
      externalIdentifier: isCard ? undefined : String(this.nextAsmachta++),
      txnDate: input.txnDate,
      processedDate: isCard ? cycleChargeDate(input.accountId, input.txnDate) : undefined,
      chargedAmountAgorot: input.amount,
      originalAmountMinor: input.fx ? input.fx.originalMinor : undefined,
      originalCurrency: input.fx ? input.fx.currency : undefined,
      status: 'completed',
      descriptionRaw: input.description,
      memo: input.memo,
      installmentNumber: input.installment?.number,
      installmentTotal: input.installment?.total,
      expectedCategorySlug: input.slug,
      isFixed: input.isFixed ?? false,
      tag: input.tag,
    };
    if (input.counterpartKey !== undefined) row.counterpartKey = input.counterpartKey;
    this.rows.push(row);
    return row;
  }
}

export function generateHousehold(opts: GenerateOptions = {}): Household {
  const seed = opts.seed ?? 42;
  const monthCount = opts.months ?? 12;
  if (!Number.isInteger(monthCount) || monthCount < 1)
    throw new RangeError(`months must be a positive integer, got ${monthCount}`);
  const endMonth = opts.endMonth ?? monthOf(todayInJerusalem());
  const months: IsoMonth[] = Array.from({ length: monthCount }, (_, i) =>
    addMonths(endMonth, i - (monthCount - 1)),
  );
  const windowEnd = monthRange(endMonth).to;
  const clamp = (d: IsoDate): IsoDate => (compareDates(d, windowEnd) > 0 ? windowEnd : d);

  const rng = new Rng(seed);
  const b = new Builder(seed);

  // --- Monthly rows: income, fixed bills on checking, card purchases, subscriptions.
  for (const [i, month] of months.entries()) {
    const incomeCount = rng.weighted([
      { weight: 15, n: 0 },
      { weight: 35, n: 1 },
      { weight: 35, n: 2 },
      { weight: 15, n: 3 },
    ]).n;
    for (let k = 0; k < incomeCount; k++) {
      b.add({
        accountId: CHECKING_ID,
        txnDate: dateIn(month, rng.int(1, 28)),
        amount: rng.int(400, 1800) * 1000,
        description: rng.pick(incomePayers),
        slug: 'income.freelance',
        tag: 'income',
      });
    }

    b.add({
      accountId: CHECKING_ID,
      txnDate: dateIn(month, 1),
      amount: -520_000,
      description: '\u200fשכר דירה - י. כהן',
      slug: 'housing.rent',
      tag: 'rent',
      isFixed: true,
    });
    if (i % 2 === 0)
      b.add({
        accountId: CHECKING_ID,
        txnDate: dateIn(month, 5),
        amount: -134_000,
        description: 'עיריית תל אביב-יפו - ארנונה',
        slug: 'housing.arnona',
        tag: 'arnona',
        isFixed: true,
      });
    if (i % 2 === 1)
      b.add({
        accountId: CHECKING_ID,
        txnDate: dateIn(month, 12),
        amount: -rng.int(380, 1100) * 100,
        description: 'חברת החשמל  לישראל',
        slug: 'utilities.electricity',
        tag: 'standing_order',
        isFixed: true,
      });
    b.add({
      accountId: CHECKING_ID,
      txnDate: dateIn(month, 8),
      amount: -8990,
      description: 'סלקום ישראל בע"מ',
      slug: 'utilities.phone',
      tag: 'standing_order',
      isFixed: true,
    });
    b.add({
      accountId: CHECKING_ID,
      txnDate: dateIn(month, 8),
      amount: -11900,
      description: 'בזק בינלאומי בע"מ',
      slug: 'utilities.internet',
      tag: 'standing_order',
      isFixed: true,
    });
    b.add({
      accountId: CHECKING_ID,
      txnDate: dateIn(month, 15),
      amount: -21500,
      description: 'מכבי שירותי בריאות',
      slug: 'health.insurance',
      tag: 'standing_order',
      isFixed: true,
    });
    b.add({
      accountId: CHECKING_ID,
      txnDate: dateIn(month, 28),
      amount: -rng.int(12, 32) * 100,
      description: 'עמלת ניהול חשבון',
      slug: 'finance.fees',
      tag: 'fee',
      isFixed: true,
    });

    const purchaseCount = rng.int(80, 150);
    for (let k = 0; k < purchaseCount; k++) {
      const merchant: Merchant = rng.chance(0.13)
        ? rng.weighted(unknownMerchants)
        : rng.weighted(knownMerchants);
      b.add({
        accountId: rng.chance(0.6) ? MAX_ID : CAL_ID,
        txnDate: dateIn(month, rng.int(1, daysInMonth(month))),
        amount: -rng.int(merchant.minAgorot, merchant.maxAgorot),
        description: decorateDescription(merchant, rng),
        slug: merchant.slug,
        tag: 'card_purchase',
      });
    }

    for (const s of subscriptions) {
      b.add({
        accountId: MAX_ID,
        txnDate: dateIn(month, s.day),
        amount: -s.agorot,
        description: s.name,
        slug: s.slug,
        tag: 'subscription',
        isFixed: true,
      });
    }
  }

  // --- Two genuinely identical purchases in one month (same merchant, amount, day): both count.
  const twinMonth = months[Math.min(3, monthCount - 1)]!;
  for (let k = 0; k < 2; k++) {
    b.add({
      accountId: MAX_ID,
      txnDate: dateIn(twinMonth, 7),
      amount: -6490,
      description: 'WOLT',
      slug: 'food.delivery',
      tag: 'card_purchase',
    });
  }

  // --- Installment plans: one row per cycle month, shared counterpartKey, the remainder on the first row.
  const plans = [
    {
      desc: 'איקאה ראשל"צ',
      slug: 'shopping.home',
      total: 478_800,
      n: 12,
      startIdx: 0,
      day: 14,
      accountId: MAX_ID,
    },
    {
      desc: 'KSP מחשבים',
      slug: UNCATEGORIZED_SLUG,
      total: 359_400,
      n: 6,
      startIdx: Math.max(0, monthCount - 4),
      day: 3,
      accountId: CAL_ID,
    },
  ];
  for (const [p, plan] of plans.entries()) {
    const per = Math.floor(plan.total / plan.n);
    for (let k = 0; k < plan.n; k++) {
      const month = months[plan.startIdx + k];
      if (month === undefined) break;
      b.add({
        accountId: plan.accountId,
        txnDate: dateIn(month, plan.day),
        amount: -(k === 0 ? plan.total - per * (plan.n - 1) : per),
        description: plan.desc,
        slug: plan.slug,
        tag: 'installment',
        counterpartKey: `inst-${p}`,
        installment: { number: k + 1, total: plan.n },
      });
    }
  }

  // --- Refunds: positive, same merchant, ≤ original, 5–40 days later; the first one always crosses a month.
  const refundable = b.rows.filter(
    (r) => r.tag === 'card_purchase' && r.counterpartKey === undefined,
  );
  const early = refundable.filter((r) => months.indexOf(monthOf(r.txnDate)) <= monthCount - 3);
  const pool = early.length > 0 ? early : refundable;
  for (let k = 0; k < 3; k++) {
    const candidates = k === 0 ? pool.filter((r) => Number(r.txnDate.slice(8)) >= 20) : pool;
    const original = rng.pick(candidates.filter((r) => r.counterpartKey === undefined));
    const magnitude = -original.chargedAmountAgorot;
    const key = `refund-${k}`;
    original.counterpartKey = key;
    b.add({
      accountId: original.accountId,
      txnDate: clamp(addDays(original.txnDate, k === 0 ? rng.int(15, 40) : rng.int(5, 40))),
      amount: rng.chance(0.5) ? magnitude : Math.trunc((magnitude * rng.int(30, 95)) / 100),
      description: original.descriptionRaw,
      slug: original.expectedCategorySlug,
      tag: 'refund',
      counterpartKey: key,
    });
  }

  // --- Own transfers checking → savings: both legs excluded from totals.
  for (let k = 0; k < 4; k++) {
    const month = months[Math.floor((k * monthCount) / 4)]!;
    const out = dateIn(month, rng.int(3, 25));
    const amount = rng.int(2, 10) * 100_000;
    const key = `xfer-${k}`;
    b.add({
      accountId: CHECKING_ID,
      txnDate: out,
      amount: -amount,
      description: 'העברה לחשבון ****5678',
      slug: 'transfer.own',
      tag: 'transfer',
      counterpartKey: key,
    });
    b.add({
      accountId: SAVINGS_ID,
      txnDate: addDays(out, rng.int(0, 2)),
      amount,
      description: 'העברה מחשבון ****1234',
      slug: 'transfer.own',
      tag: 'transfer',
      counterpartKey: key,
    });
  }

  // --- Foreign-currency purchases plus a small rate-difference adjustment 3 days later.
  const foreign = [
    {
      desc: 'AMAZON.COM',
      slug: 'shopping.online',
      currency: 'USD',
      originalMinor: 7999,
      rateBp: 37_250,
      idx: Math.min(2, monthCount - 1),
      day: 9,
      accountId: MAX_ID,
    },
    {
      desc: 'BOOKING.COM',
      slug: UNCATEGORIZED_SLUG,
      currency: 'EUR',
      originalMinor: 24_000,
      rateBp: 40_480,
      idx: Math.max(0, monthCount - 3),
      day: 17,
      accountId: CAL_ID,
    },
  ];
  for (const [k, f] of foreign.entries()) {
    const charged = Math.trunc((f.originalMinor * f.rateBp + 5000) / 10_000);
    const txnDate = dateIn(months[f.idx]!, f.day);
    const key = `fx-${k}`;
    b.add({
      accountId: f.accountId,
      txnDate,
      amount: -charged,
      description: f.desc,
      slug: f.slug,
      tag: 'fx',
      counterpartKey: key,
      fx: { currency: f.currency, originalMinor: -f.originalMinor },
    });
    b.add({
      accountId: f.accountId,
      txnDate: clamp(addDays(txnDate, 3)),
      amount: -Math.trunc((charged * 12 + 500) / 1000),
      description: f.desc,
      slug: f.slug,
      tag: 'fx',
      memo: 'הפרשי שער',
      counterpartKey: key,
    });
  }

  // --- The last 3 card purchases of the final month are still pending.
  const lastPurchases = b.rows
    .map((row, seq) => ({ row, seq }))
    .filter(({ row }) => row.tag === 'card_purchase' && monthOf(row.txnDate) === endMonth)
    .sort((a, b2) => compareDates(a.row.txnDate, b2.row.txnDate) || a.seq - b2.seq)
    .slice(-3);
  for (const { row } of lastPurchases) row.status = 'pending';

  // --- Card settlements: one checking debit per card per charge date, equal to the cycle's sum.
  const cycles = new Map<string, FixtureTxn[]>();
  for (const row of b.rows) {
    if (row.processedDate === undefined) continue;
    const key = `${row.accountId}|${row.processedDate}`;
    cycles.set(key, [...(cycles.get(key) ?? []), row]);
  }
  for (const [key, rows] of [...cycles.entries()].sort(([a], [b2]) => a.localeCompare(b2))) {
    const [accountId, chargeDate] = key.split('|') as [string, IsoDate];
    if (compareDates(chargeDate, windowEnd) > 0) continue;
    b.add({
      accountId: CHECKING_ID,
      txnDate: chargeDate,
      amount: sum(rows.map((r) => r.chargedAmountAgorot)),
      description: settlementDescription[accountId] ?? accountId,
      slug: 'transfer.card_settlement',
      tag: 'card_settlement',
      counterpartKey: `settle:${accountId}:${addMonths(monthOf(chargeDate), -1)}`,
    });
  }

  const transactions = b.rows
    .map((row, seq) => ({ row, seq }))
    .sort(
      (a, b2) =>
        compareDates(a.row.txnDate, b2.row.txnDate) ||
        a.row.accountId.localeCompare(b2.row.accountId) ||
        a.seq - b2.seq,
    )
    .map(({ row }) => row);

  return {
    accounts: accounts.map((a) => ({ ...a })),
    transactions,
    expectations: computeExpectations(transactions, months),
    seed,
  };
}
