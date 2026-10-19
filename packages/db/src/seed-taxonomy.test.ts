/** The taxonomy seed runs from `migrate up`, is versioned, and only ever adds: user deletions and edits survive. */
import { seedRules } from '@pinkas/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrate.js';
import { defaultTaxonomySeed, seedKeyOf, seedTaxonomy, seedVersionOf } from './seed-taxonomy.js';
import { startTestDb, type TestDb } from './test-db.js';

const count = async (t: TestDb, sql: string, params: unknown[] = []) =>
  Number((await t.pool.query<{ n: string }>(sql, params)).rows[0]!.n);
const seedRuleCount = (t: TestDb) =>
  count(t, "SELECT count(*)::text AS n FROM category_rules WHERE origin = 'seed'");
const categoryCount = (t: TestDb) => count(t, 'SELECT count(*)::text AS n FROM categories');
const storedVersion = (t: TestDb) =>
  count(t, "SELECT version::text AS n FROM seed_versions WHERE name = 'taxonomy'");

describe('taxonomy seed via migrate up', () => {
  let t: TestDb;
  const [deleted, edited] = [seedRules[0]!, seedRules[1]!];
  beforeAll(async () => {
    t = await startTestDb(); // a fresh database: startTestDb runs migrateUp, exactly as the migrate service does
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  it('(a) migrate up on an empty database seeds every category and rule, with parents, at the code version', async () => {
    expect(seedVersionOf(defaultTaxonomySeed)).toBe(1);
    expect(await categoryCount(t)).toBe(defaultTaxonomySeed.categories.length);
    expect(await seedRuleCount(t)).toBe(seedRules.length);
    expect(await storedVersion(t)).toBe(1);
    const { rows } = await t.pool.query<{ parent: string }>(
      "SELECT p.slug AS parent FROM categories c JOIN categories p ON p.id = c.parent_id WHERE c.slug = 'food.groceries'",
    );
    expect(rows[0]?.parent).toBe('food');
  });

  it('(b) a deleted or edited seed rule, and an edited category, survive the next migrate up', async () => {
    await t.pool.query('DELETE FROM category_rules WHERE seed_key = $1', [seedKeyOf(deleted)]);
    await t.pool.query(
      "UPDATE category_rules SET pattern = 'my own pattern', enabled = false WHERE seed_key = $1",
      [seedKeyOf(edited)],
    );
    await t.pool.query(
      "UPDATE categories SET name_he = 'השם שלי', parent_id = NULL WHERE slug = 'food.groceries'",
    );
    const before = { rules: await seedRuleCount(t), categories: await categoryCount(t) };

    expect(await migrateUp(t.pool)).toEqual([]); // a restart: no migrations pending, seed already at v1
    expect(await migrateUp(t.pool)).toEqual([]);

    expect(await seedRuleCount(t)).toBe(before.rules);
    expect(await categoryCount(t)).toBe(before.categories);
    expect(
      await count(t, 'SELECT count(*)::text AS n FROM category_rules WHERE seed_key = $1', [
        seedKeyOf(deleted),
      ]),
    ).toBe(0);
    const e = await t.pool.query<{ pattern: string; enabled: boolean }>(
      'SELECT pattern, enabled FROM category_rules WHERE seed_key = $1',
      [seedKeyOf(edited)],
    );
    expect(e.rows).toEqual([{ pattern: 'my own pattern', enabled: false }]);
    const c = await t.pool.query<{ name_he: string; parent_id: string | null }>(
      "SELECT name_he, parent_id FROM categories WHERE slug = 'food.groceries'",
    );
    expect(c.rows).toEqual([{ name_he: 'השם שלי', parent_id: null }]);
  });

  it('(c) a version bump with one new category and rule adds exactly those, and nothing deleted returns', async () => {
    const bumped = {
      categories: [
        ...defaultTaxonomySeed.categories,
        {
          slug: 'food.test_new',
          nameHe: 'קטגוריה חדשה',
          kind: 'expense' as const,
          parentSlug: 'food',
          since: 2,
        },
      ],
      rules: [...seedRules, { pattern: 'בדיקה חדשה', slug: 'food.test_new', since: 2 }],
    };
    const before = { rules: await seedRuleCount(t), categories: await categoryCount(t) };

    expect(await seedTaxonomy(t.db, bumped)).toEqual({ from: 1, to: 2, categories: 1, rules: 1 });
    expect(await categoryCount(t)).toBe(before.categories + 1);
    expect(await seedRuleCount(t)).toBe(before.rules + 1);
    expect(await storedVersion(t)).toBe(2);
    const { rows } = await t.pool.query<{ parent: string }>(
      "SELECT p.slug AS parent FROM categories c JOIN categories p ON p.id = c.parent_id WHERE c.slug = 'food.test_new'",
    );
    expect(rows[0]?.parent).toBe('food');
    // Everything from (b) still holds: the bump only looked at items with since > 1.
    expect(
      await count(t, 'SELECT count(*)::text AS n FROM category_rules WHERE seed_key = $1', [
        seedKeyOf(deleted),
      ]),
    ).toBe(0);
    expect(
      (await t.pool.query("SELECT parent_id FROM categories WHERE slug = 'food.groceries'")).rows,
    ).toEqual([{ parent_id: null }]);

    expect(await seedTaxonomy(t.db, bumped)).toEqual({ from: 2, to: 2, categories: 0, rules: 0 });
    // Code at v1 against a database at v2 (e.g. a rollback): nothing is applied or downgraded.
    expect(await seedTaxonomy(t.db)).toEqual({ from: 2, to: 2, categories: 0, rules: 0 });
    expect(await storedVersion(t)).toBe(2);
  });
});

describe('upgrading a database seeded before versioning', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  it('0003 keys the existing seed rules and records v1, so a rule deleted earlier is not re-added', async () => {
    expect(await migrateDown(t.pool)).toBe('0003_seed_versions.sql'); // back to the pre-versioning schema
    await t.pool.query('DELETE FROM category_rules WHERE pattern = $1', [seedRules[0]!.pattern]);
    const before = await seedRuleCount(t);

    expect(await migrateUp(t.pool)).toEqual(['0003_seed_versions.sql']);
    expect(await storedVersion(t)).toBe(1);
    expect(await seedRuleCount(t)).toBe(before);
    expect(
      await count(
        t,
        "SELECT count(*)::text AS n FROM category_rules WHERE origin = 'seed' AND seed_key IS NULL",
      ),
    ).toBe(0);
  });
});
