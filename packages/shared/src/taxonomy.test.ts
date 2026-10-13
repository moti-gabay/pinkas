import { describe, expect, it } from 'vitest';
import { defaultTaxonomy, flattenTaxonomy, seedRules } from './taxonomy.js';

describe('taxonomy', () => {
  const flat = flattenTaxonomy(defaultTaxonomy);
  it('has unique slugs', () => {
    expect(new Set(flat.map((c) => c.slug)).size).toBe(flat.length);
  });
  it('children carry their parent slug prefix', () => {
    for (const c of flat)
      if (c.parentSlug) expect(c.slug.startsWith(`${c.parentSlug}.`)).toBe(true);
  });
  it('every seed rule points to an existing slug', () => {
    const slugs = new Set(flat.map((c) => c.slug));
    for (const r of seedRules) expect(slugs.has(r.slug), r.slug).toBe(true);
  });
});
