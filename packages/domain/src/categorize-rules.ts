/**
 * Rules engine: first enabled rule by priority wins (lower number = higher priority; user rules get
 * lower numbers than seed rules). Pure: the caller loads rules once and passes them in.
 */
export type RuleMatch = 'contains' | 'exact' | 'prefix' | 'regex';
export type RuleField = 'merchant_normalized' | 'description_raw';

export interface CategoryRule {
  id: string;
  pattern: string;
  match: RuleMatch;
  field: RuleField;
  categoryId: string;
  isFixed: boolean | undefined;
  priority: number;
  accountScope: string | undefined;
  enabled: boolean;
}

export interface RuleInput {
  accountId: string;
  merchantNormalized: string;
  descriptionRaw: string;
}

export interface RuleHit {
  rule: CategoryRule;
  categoryId: string;
  isFixed: boolean | undefined;
}

const regexCache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let re: RegExp | null;
  try {
    re = new RegExp(pattern, 'iu');
  } catch {
    re = null; // invalid user regex: the rule simply never matches
  }
  regexCache.set(pattern, re);
  return re;
}

export function ruleMatches(rule: CategoryRule, input: RuleInput): boolean {
  if (!rule.enabled) return false;
  if (rule.accountScope !== undefined && rule.accountScope !== input.accountId) return false;
  const haystack =
    rule.field === 'merchant_normalized' ? input.merchantNormalized : input.descriptionRaw;
  const needle = rule.pattern.toLowerCase();
  const hay = haystack.toLowerCase();
  switch (rule.match) {
    case 'contains':
      return needle !== '' && hay.includes(needle);
    case 'exact':
      return hay === needle;
    case 'prefix':
      return needle !== '' && hay.startsWith(needle);
    case 'regex':
      return compile(rule.pattern)?.test(haystack) ?? false;
  }
}

/** Sort once per batch; rules with equal priority fall back to longer (more specific) patterns first. */
export function sortRules(rules: readonly CategoryRule[]): CategoryRule[] {
  return [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length);
}

export function applyRules(
  sortedRules: readonly CategoryRule[],
  input: RuleInput,
): RuleHit | undefined {
  for (const rule of sortedRules) {
    if (ruleMatches(rule, input))
      return { rule, categoryId: rule.categoryId, isFixed: rule.isFixed };
  }
  return undefined;
}

/** The rule proposed when the user corrects a category by hand: exact match on the normalized merchant. */
export function proposeLearnedRule(
  input: Pick<RuleInput, 'merchantNormalized'>,
  categoryId: string,
): Pick<CategoryRule, 'pattern' | 'match' | 'field' | 'categoryId'> {
  return {
    pattern: input.merchantNormalized,
    match: 'exact',
    field: 'merchant_normalized',
    categoryId,
  };
}
