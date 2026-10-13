import { UNCATEGORIZED_SLUG } from '@pinkas/shared';
import type { Rng } from './prng.js';

export interface Merchant {
  name: string;
  slug: string;
  minAgorot: number;
  maxAgorot: number;
  weight: number;
  latin?: boolean;
  branches?: boolean;
}

const m = (
  name: string,
  slug: string,
  minIls: number,
  maxIls: number,
  weight: number,
  flags: Pick<Merchant, 'latin' | 'branches'> = {},
): Merchant => ({ name, slug, minAgorot: minIls * 100, maxAgorot: maxIls * 100, weight, ...flags });

/** Merchants whose names hit a `seedRules` pattern (after normalizeMerchant). */
export const knownMerchants: readonly Merchant[] = [
  m('שופרסל דיל', 'food.groceries', 40, 650, 10, { branches: true }),
  m('רמי לוי שיווק השקמה', 'food.groceries', 120, 900, 8, { branches: true }),
  m('ויקטורי', 'food.groceries', 30, 300, 4, { branches: true }),
  m('יוחננוף', 'food.groceries', 100, 700, 3),
  m('אושר עד', 'food.groceries', 150, 800, 2),
  m('טיב טעם', 'food.groceries', 25, 250, 3, { branches: true }),
  m('חצי חינם', 'food.groceries', 90, 600, 2),
  m('WOLT', 'food.delivery', 45, 180, 9, { latin: true }),
  m('תן ביס', 'food.delivery', 40, 150, 3),
  m('10BIS.CO.IL', 'food.delivery', 35, 120, 2, { latin: true }),
  m('פז', 'transport.fuel', 150, 420, 4, { branches: true }),
  m('סונול', 'transport.fuel', 140, 400, 2),
  m('דלק מנטה', 'transport.fuel', 15, 90, 2),
  m('רב קו', 'transport.public', 5, 60, 7),
  m('רכבת ישראל', 'transport.public', 10, 80, 2),
  m('פנגו', 'transport.parking', 6, 45, 6),
  m('סלופארק', 'transport.parking', 8, 40, 2),
  m('GETT', 'transport.taxi', 30, 120, 3, { latin: true }),
  m('YANGO', 'transport.taxi', 25, 100, 2, { latin: true }),
  m('סופר פארם', 'health.pharmacy', 25, 300, 6, { branches: true }),
  m('סופר-פארם', 'health.pharmacy', 20, 200, 2),
  m('AMAZON.COM', 'shopping.online', 60, 600, 3, { latin: true }),
  m('ALIEXPRESS', 'shopping.online', 15, 200, 3, { latin: true }),
  m('EBAY', 'shopping.online', 40, 350, 1, { latin: true }),
  m('איקאה', 'shopping.home', 80, 1500, 2, { branches: true }),
  m('IKEA RISHON', 'shopping.home', 50, 900, 1, { latin: true }),
  m('מגה בעיר', 'food.groceries', 30, 220, 1),
];

/** Merchants that match no seed rule: should end up `uncategorized`. Mostly restaurants and cafés. */
export const unknownMerchants: readonly Merchant[] = [
  m('קפה גרג', UNCATEGORIZED_SLUG, 28, 140, 5, { branches: true }),
  m('ארומה אספרסו בר', UNCATEGORIZED_SLUG, 18, 95, 5, { branches: true }),
  m('פיצה פאצה', UNCATEGORIZED_SLUG, 45, 160, 3),
  m('שיפודי התקווה', UNCATEGORIZED_SLUG, 80, 320, 2),
  m('גולדה גלידה', UNCATEGORIZED_SLUG, 22, 75, 2),
  m('סטימצקי', UNCATEGORIZED_SLUG, 40, 260, 2, { branches: true }),
  m('ZARA', UNCATEGORIZED_SLUG, 90, 600, 2, { latin: true }),
  m('H&M', UNCATEGORIZED_SLUG, 60, 450, 2, { latin: true }),
  m('KSP מחשבים', UNCATEGORIZED_SLUG, 50, 1200, 1),
  m('מספרת שי', UNCATEGORIZED_SLUG, 60, 180, 1),
  m('מכבסה אקספרס', UNCATEGORIZED_SLUG, 40, 150, 1),
  m('ד"ר כהן רופא שיניים', UNCATEGORIZED_SLUG, 150, 900, 1),
];

export interface Subscription {
  name: string;
  slug: string;
  agorot: number;
  day: number;
}

/** Monthly card charges at a fixed size. */
export const subscriptions: readonly Subscription[] = [
  { name: 'NETFLIX.COM', slug: 'subscriptions.streaming', agorot: 5490, day: 3 },
  { name: 'Spotify AB', slug: 'subscriptions.streaming', agorot: 2390, day: 11 },
  { name: 'APPLE.COM/BILL', slug: 'subscriptions.software', agorot: 1290, day: 19 },
  { name: 'GOOGLE *Google One', slug: 'subscriptions.software', agorot: 990, day: 22 },
  { name: 'ANTHROPIC, PBC', slug: 'subscriptions.software', agorot: 7300, day: 6 },
  { name: 'הראל ביטוח רכב', slug: 'insurance', agorot: 18900, day: 16 },
];

export const incomePayers: readonly string[] = [
  'העברה מ- אלפא טכנולוגיות בע"מ',
  'העברה מ- סטודיו נ.ג. בע"מ',
  'זיכוי PAYPAL',
  'העברה מ- ד.ל. ייעוץ עסקי',
  'זיכוי UPWORK',
  'העברה מ- קליק מדיה בע"מ',
];

const branchCities = ['רמת גן', 'תל אביב', 'חיפה', 'ירושלים', 'באר שבע', 'נתניה'];

/** Real statements are messy: whitespace, bidi marks, branch suffixes, trailing numbers, emoji, mixed case. */
export function decorateDescription(merchant: Merchant, rng: Rng): string {
  const roll = rng.next();
  const { name } = merchant;
  if (roll < 0.7) return name;
  if (roll < 0.76) return `${name}  `;
  if (roll < 0.81) return `\u200f${name}`;
  if (roll < 0.86)
    return merchant.branches ? `${name} סניף ${rng.pick(branchCities)}` : `  ${name}`;
  if (roll < 0.92) return `${name} ${rng.int(1000, 99999)}`;
  if (roll < 0.96) return merchant.latin ? mixCase(name, rng) : `${name} 🛒`;
  return `${name} - ${rng.int(10, 99)}`;
}

function mixCase(name: string, rng: Rng): string {
  return rng.chance(0.5)
    ? name.toLowerCase()
    : name.replace(/[a-z]/gi, (c, i: number) => (i % 2 ? c.toLowerCase() : c.toUpperCase()));
}
