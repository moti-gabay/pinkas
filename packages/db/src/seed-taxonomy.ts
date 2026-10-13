import { defaultTaxonomy, flattenTaxonomy, seedRules } from '@pinkas/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { categories, categoryRules } from './schema/index.js';

/** Idempotent: inserts missing categories/seed rules, never overwrites user edits. */
export async function seedTaxonomy(db: Db): Promise<{ categories: number; rules: number }> {
  const flat = flattenTaxonomy(defaultTaxonomy);
  let sort = 0;
  for (const c of flat) {
    await db
      .insert(categories)
      .values({
        slug: c.slug,
        nameHe: c.nameHe,
        kind: c.kind,
        isFixedDefault: c.fixed ?? false,
        icon: c.icon ?? null,
        sort: sort++,
        isSystem: true,
      })
      .onConflictDoNothing({ target: categories.slug });
  }
  // parent links in a second pass (slugs are stable, ids are not)
  const rows = await db.select({ id: categories.id, slug: categories.slug }).from(categories);
  const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));
  for (const c of flat) {
    if (!c.parentSlug) continue;
    const parentId = idBySlug.get(c.parentSlug);
    if (parentId) await db.update(categories).set({ parentId }).where(eq(categories.slug, c.slug));
  }
  const existing = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(categoryRules)
    .where(eq(categoryRules.origin, 'seed'));
  let rulesInserted = 0;
  if ((existing[0]?.n ?? 0) === 0) {
    for (const r of seedRules) {
      const categoryId = idBySlug.get(r.slug);
      if (!categoryId) continue;
      await db.insert(categoryRules).values({
        pattern: r.pattern,
        match: 'contains',
        field: 'merchant_normalized',
        categoryId,
        isFixed: r.fixed ?? null,
        priority: 100,
        origin: 'seed',
      });
      rulesInserted++;
    }
  }
  return { categories: flat.length, rules: rulesInserted };
}
