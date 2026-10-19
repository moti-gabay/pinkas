/**
 * Versioned, add-only seeding of the default taxonomy (run by `migrate up`). Every category and seed rule carries
 * `since`, the seed version that introduced it. A run applies only items newer than the version stored in
 * seed_versions, inserts them with ON CONFLICT DO NOTHING, and never updates or re-creates existing rows, so a
 * seed rule or category the user deleted or edited does not come back on the next deploy.
 */
import { defaultTaxonomy, flattenTaxonomy, seedRules, type SeedRule } from '@pinkas/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { categories, categoryRules, seedVersions } from './schema/index.js';

const SEED_NAME = 'taxonomy';

export interface TaxonomySeed {
  categories: ReturnType<typeof flattenTaxonomy>;
  rules: readonly SeedRule[];
}

export interface SeedResult {
  from: number;
  to: number;
  categories: number;
  rules: number;
}

export const defaultTaxonomySeed: TaxonomySeed = {
  categories: flattenTaxonomy(defaultTaxonomy),
  rules: seedRules,
};

export const seedKeyOf = (r: SeedRule): string => `${r.slug}:${r.pattern}`;

/** The seed's version is the newest `since` in it, so adding an item with the next version is the bump. */
export function seedVersionOf(seed: TaxonomySeed): number {
  return Math.max(
    1,
    ...seed.categories.map((c) => c.since ?? 1),
    ...seed.rules.map((r) => r.since ?? 1),
  );
}

export async function seedTaxonomy(
  db: Db,
  seed: TaxonomySeed = defaultTaxonomySeed,
): Promise<SeedResult> {
  const to = seedVersionOf(seed);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ version: seedVersions.version })
      .from(seedVersions)
      .where(eq(seedVersions.name, SEED_NAME))
      .for('update');
    const from = row?.version ?? 0;
    if (from >= to) return { from, to: from, categories: 0, rules: 0 };

    const newCategories = seed.categories.filter((c) => (c.since ?? 1) > from);
    const inserted: { slug: string }[] = [];
    for (const c of newCategories) {
      inserted.push(
        ...(await tx
          .insert(categories)
          .values({
            slug: c.slug,
            nameHe: c.nameHe,
            kind: c.kind,
            isFixedDefault: c.fixed ?? false,
            icon: c.icon ?? null,
            sort: seed.categories.indexOf(c),
            isSystem: true,
          })
          .onConflictDoNothing({ target: categories.slug })
          .returning({ slug: categories.slug })),
      );
    }
    const all = await tx.select({ id: categories.id, slug: categories.slug }).from(categories);
    const idBySlug = new Map(all.map((r) => [r.slug, r.id]));
    // Parent links only for rows inserted now (slugs are stable, ids are not); existing rows are never touched.
    const insertedSlugs = new Set(inserted.map((r) => r.slug));
    for (const c of newCategories) {
      const parentId = c.parentSlug ? idBySlug.get(c.parentSlug) : undefined;
      if (insertedSlugs.has(c.slug) && parentId)
        await tx.update(categories).set({ parentId }).where(eq(categories.slug, c.slug));
    }

    let rules = 0;
    for (const r of seed.rules.filter((x) => (x.since ?? 1) > from)) {
      const categoryId = idBySlug.get(r.slug);
      if (!categoryId) continue; // its category was removed by the user: do not resurrect it through a rule
      const added = await tx
        .insert(categoryRules)
        .values({
          pattern: r.pattern,
          match: 'contains',
          field: 'merchant_normalized',
          categoryId,
          isFixed: r.fixed ?? null,
          priority: 100,
          origin: 'seed',
          seedKey: seedKeyOf(r),
        })
        .onConflictDoNothing({ target: categoryRules.seedKey })
        .returning({ id: categoryRules.id });
      rules += added.length;
    }

    await tx
      .insert(seedVersions)
      .values({ name: SEED_NAME, version: to })
      .onConflictDoUpdate({
        target: seedVersions.name,
        set: { version: to, appliedAt: new Date() },
      });
    return { from, to, categories: insertedSlugs.size, rules };
  });
}
