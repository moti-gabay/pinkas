/**
 * Default Hebrew category taxonomy. Slugs are stable identifiers (used by rules, LLM output and tests);
 * Hebrew names are display only. `fixed` marks expenses that recur at a known size (rent, insurance).
 */
export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface CategoryDef {
  slug: string;
  nameHe: string;
  kind: CategoryKind;
  fixed?: boolean;
  icon?: string;
  children?: CategoryDef[];
  /** Seed version that introduced this item (default 1). New items get the next version; never edit old ones. */
  since?: number;
}

export const UNCATEGORIZED_SLUG = 'uncategorized';

export const defaultTaxonomy: CategoryDef[] = [
  {
    slug: 'food',
    nameHe: 'מזון',
    kind: 'expense',
    icon: '🛒',
    children: [
      { slug: 'food.groceries', nameHe: 'סופרמרקט', kind: 'expense' },
      { slug: 'food.restaurants', nameHe: 'מסעדות ובתי קפה', kind: 'expense' },
      { slug: 'food.delivery', nameHe: 'משלוחים', kind: 'expense' },
    ],
  },
  {
    slug: 'housing',
    nameHe: 'דיור',
    kind: 'expense',
    fixed: true,
    icon: '🏠',
    children: [
      { slug: 'housing.rent', nameHe: 'שכר דירה / משכנתא', kind: 'expense', fixed: true },
      { slug: 'housing.arnona', nameHe: 'ארנונה', kind: 'expense', fixed: true },
      { slug: 'housing.vaad', nameHe: 'ועד בית', kind: 'expense', fixed: true },
      { slug: 'housing.maintenance', nameHe: 'תחזוקה ותיקונים', kind: 'expense' },
    ],
  },
  {
    slug: 'utilities',
    nameHe: 'חשבונות',
    kind: 'expense',
    fixed: true,
    icon: '💡',
    children: [
      { slug: 'utilities.electricity', nameHe: 'חשמל', kind: 'expense', fixed: true },
      { slug: 'utilities.water', nameHe: 'מים', kind: 'expense', fixed: true },
      { slug: 'utilities.gas', nameHe: 'גז', kind: 'expense', fixed: true },
      { slug: 'utilities.internet', nameHe: 'אינטרנט וטלוויזיה', kind: 'expense', fixed: true },
      { slug: 'utilities.phone', nameHe: 'סלולר', kind: 'expense', fixed: true },
    ],
  },
  {
    slug: 'transport',
    nameHe: 'תחבורה',
    kind: 'expense',
    icon: '🚗',
    children: [
      { slug: 'transport.fuel', nameHe: 'דלק', kind: 'expense' },
      { slug: 'transport.public', nameHe: 'תחבורה ציבורית', kind: 'expense' },
      { slug: 'transport.parking', nameHe: 'חניה וכבישי אגרה', kind: 'expense' },
      { slug: 'transport.taxi', nameHe: 'מוניות', kind: 'expense' },
      { slug: 'transport.car', nameHe: 'רכב: ביטוח, טסט, טיפולים', kind: 'expense', fixed: true },
    ],
  },
  {
    slug: 'health',
    nameHe: 'בריאות',
    kind: 'expense',
    icon: '🩺',
    children: [
      { slug: 'health.insurance', nameHe: 'ביטוח בריאות', kind: 'expense', fixed: true },
      { slug: 'health.pharmacy', nameHe: 'בית מרקחת', kind: 'expense' },
      { slug: 'health.doctors', nameHe: 'רופאים וטיפולים', kind: 'expense' },
      { slug: 'health.sport', nameHe: 'ספורט וכושר', kind: 'expense', fixed: true },
    ],
  },
  {
    slug: 'kids',
    nameHe: 'ילדים',
    kind: 'expense',
    icon: '🧒',
    children: [
      { slug: 'kids.education', nameHe: 'גן / חינוך', kind: 'expense', fixed: true },
      { slug: 'kids.activities', nameHe: 'חוגים', kind: 'expense', fixed: true },
      { slug: 'kids.gear', nameHe: 'ציוד וביגוד לילדים', kind: 'expense' },
    ],
  },
  {
    slug: 'entertainment',
    nameHe: 'פנאי ובילויים',
    kind: 'expense',
    icon: '🎬',
    children: [
      { slug: 'entertainment.culture', nameHe: 'תרבות ואירועים', kind: 'expense' },
      { slug: 'entertainment.travel', nameHe: 'נסיעות וחופשות', kind: 'expense' },
      { slug: 'entertainment.hobbies', nameHe: 'תחביבים', kind: 'expense' },
    ],
  },
  {
    slug: 'subscriptions',
    nameHe: 'מנויים',
    kind: 'expense',
    fixed: true,
    icon: '🔁',
    children: [
      { slug: 'subscriptions.streaming', nameHe: 'סטרימינג ומוזיקה', kind: 'expense', fixed: true },
      { slug: 'subscriptions.software', nameHe: 'תוכנה ושירותים', kind: 'expense', fixed: true },
    ],
  },
  {
    slug: 'shopping',
    nameHe: 'קניות',
    kind: 'expense',
    icon: '🛍️',
    children: [
      { slug: 'shopping.clothing', nameHe: 'ביגוד והנעלה', kind: 'expense' },
      { slug: 'shopping.home', nameHe: 'בית וריהוט', kind: 'expense' },
      { slug: 'shopping.electronics', nameHe: 'אלקטרוניקה', kind: 'expense' },
      { slug: 'shopping.online', nameHe: 'קניות אונליין', kind: 'expense' },
    ],
  },
  { slug: 'insurance', nameHe: 'ביטוחים', kind: 'expense', fixed: true, icon: '🛡️' },
  {
    slug: 'finance',
    nameHe: 'פיננסי',
    kind: 'expense',
    icon: '🏦',
    children: [
      { slug: 'finance.fees', nameHe: 'עמלות בנק וכרטיס', kind: 'expense' },
      { slug: 'finance.interest', nameHe: 'ריבית', kind: 'expense' },
      { slug: 'finance.savings', nameHe: 'חיסכון והשקעות', kind: 'expense' },
      { slug: 'finance.taxes', nameHe: 'מיסים', kind: 'expense' },
    ],
  },
  { slug: 'business', nameHe: 'הוצאות עסק', kind: 'expense', icon: '💼' },
  { slug: 'gifts', nameHe: 'מתנות ותרומות', kind: 'expense', icon: '🎁' },
  { slug: 'pets', nameHe: 'חיות מחמד', kind: 'expense', icon: '🐾' },
  { slug: 'other', nameHe: 'אחר', kind: 'expense', icon: '📦' },
  { slug: UNCATEGORIZED_SLUG, nameHe: 'ללא קטגוריה', kind: 'expense', icon: '❓' },

  {
    slug: 'income',
    nameHe: 'הכנסות',
    kind: 'income',
    icon: '💰',
    children: [
      { slug: 'income.freelance', nameHe: 'הכנסה מעסק / פרילנס', kind: 'income' },
      { slug: 'income.salary', nameHe: 'משכורת', kind: 'income' },
      { slug: 'income.refund', nameHe: 'החזרים ממוסדות', kind: 'income' },
      { slug: 'income.interest', nameHe: 'ריבית ודיבידנד', kind: 'income' },
      { slug: 'income.other', nameHe: 'הכנסה אחרת', kind: 'income' },
    ],
  },
  {
    slug: 'transfer',
    nameHe: 'העברות בין חשבונות',
    kind: 'transfer',
    icon: '🔄',
    children: [
      { slug: 'transfer.card_settlement', nameHe: 'חיוב כרטיס אשראי', kind: 'transfer' },
      { slug: 'transfer.own', nameHe: 'העברה עצמית', kind: 'transfer' },
    ],
  },
];

export function flattenTaxonomy(
  defs: CategoryDef[] = defaultTaxonomy,
  parent?: string,
): (CategoryDef & { parentSlug: string | undefined })[] {
  const out: (CategoryDef & { parentSlug: string | undefined })[] = [];
  for (const d of defs) {
    const { children, ...rest } = d;
    out.push({ ...rest, parentSlug: parent });
    if (children) out.push(...flattenTaxonomy(children, d.slug));
  }
  return out;
}

export interface SeedRule {
  pattern: string;
  slug: string;
  fixed?: boolean;
  /** Seed version that introduced this rule (default 1), as for CategoryDef. */
  since?: number;
}

/** Seed rules: pattern (matched against merchant_normalized, `contains`) → slug. Users edit these freely. */
export const seedRules: readonly SeedRule[] = [
  { pattern: 'שופרסל', slug: 'food.groceries' },
  { pattern: 'רמי לוי', slug: 'food.groceries' },
  { pattern: 'ויקטורי', slug: 'food.groceries' },
  { pattern: 'יוחננוף', slug: 'food.groceries' },
  { pattern: 'מגה', slug: 'food.groceries' },
  { pattern: 'אושר עד', slug: 'food.groceries' },
  { pattern: 'טיב טעם', slug: 'food.groceries' },
  { pattern: 'חצי חינם', slug: 'food.groceries' },
  { pattern: 'wolt', slug: 'food.delivery' },
  { pattern: 'וולט', slug: 'food.delivery' },
  { pattern: '10bis', slug: 'food.delivery' },
  { pattern: 'תן ביס', slug: 'food.delivery' },
  { pattern: 'פז', slug: 'transport.fuel' },
  { pattern: 'סונול', slug: 'transport.fuel' },
  { pattern: 'דלק', slug: 'transport.fuel' },
  { pattern: 'דור אלון', slug: 'transport.fuel' },
  { pattern: 'yellow', slug: 'transport.fuel' },
  { pattern: 'רב קו', slug: 'transport.public' },
  { pattern: 'רכבת ישראל', slug: 'transport.public' },
  { pattern: 'אגד', slug: 'transport.public' },
  { pattern: 'פנגו', slug: 'transport.parking' },
  { pattern: 'סלופארק', slug: 'transport.parking' },
  { pattern: 'כביש 6', slug: 'transport.parking' },
  { pattern: 'gett', slug: 'transport.taxi' },
  { pattern: 'yango', slug: 'transport.taxi' },
  { pattern: 'חברת החשמל', slug: 'utilities.electricity', fixed: true },
  { pattern: 'חח"י', slug: 'utilities.electricity', fixed: true },
  { pattern: 'מי ', slug: 'utilities.water', fixed: true },
  { pattern: 'מקורות', slug: 'utilities.water', fixed: true },
  { pattern: 'סלקום', slug: 'utilities.phone', fixed: true },
  { pattern: 'פרטנר', slug: 'utilities.phone', fixed: true },
  { pattern: 'פלאפון', slug: 'utilities.phone', fixed: true },
  { pattern: 'הוט מובייל', slug: 'utilities.phone', fixed: true },
  { pattern: 'בזק', slug: 'utilities.internet', fixed: true },
  { pattern: 'hot', slug: 'utilities.internet', fixed: true },
  { pattern: 'yes', slug: 'utilities.internet', fixed: true },
  { pattern: 'ארנונה', slug: 'housing.arnona', fixed: true },
  { pattern: 'עיריית', slug: 'housing.arnona', fixed: true },
  { pattern: 'שכר דירה', slug: 'housing.rent', fixed: true },
  { pattern: 'שכ"ד', slug: 'housing.rent', fixed: true },
  { pattern: 'ועד בית', slug: 'housing.vaad', fixed: true },
  { pattern: 'סופר פארם', slug: 'health.pharmacy' },
  { pattern: 'סופר-פארם', slug: 'health.pharmacy' },
  { pattern: 'מכבי', slug: 'health.insurance', fixed: true },
  { pattern: 'כללית', slug: 'health.insurance', fixed: true },
  { pattern: 'מאוחדת', slug: 'health.insurance', fixed: true },
  { pattern: 'netflix', slug: 'subscriptions.streaming', fixed: true },
  { pattern: 'spotify', slug: 'subscriptions.streaming', fixed: true },
  { pattern: 'youtube', slug: 'subscriptions.streaming', fixed: true },
  { pattern: 'apple.com', slug: 'subscriptions.software', fixed: true },
  { pattern: 'google', slug: 'subscriptions.software', fixed: true },
  { pattern: 'anthropic', slug: 'subscriptions.software', fixed: true },
  { pattern: 'amazon', slug: 'shopping.online' },
  { pattern: 'aliexpress', slug: 'shopping.online' },
  { pattern: 'ebay', slug: 'shopping.online' },
  { pattern: 'איקאה', slug: 'shopping.home' },
  { pattern: 'ikea', slug: 'shopping.home' },
  { pattern: 'עמלה', slug: 'finance.fees' },
  { pattern: 'דמי כרטיס', slug: 'finance.fees' },
  { pattern: 'ריבית', slug: 'finance.interest' },
  { pattern: 'ביטוח לאומי', slug: 'finance.taxes' },
  { pattern: 'מס הכנסה', slug: 'finance.taxes' },
  { pattern: 'מע"מ', slug: 'finance.taxes' },
  { pattern: 'ביטוח', slug: 'insurance', fixed: true },
  { pattern: 'משכורת', slug: 'income.salary' },
  { pattern: 'שכר', slug: 'income.salary' },
];
