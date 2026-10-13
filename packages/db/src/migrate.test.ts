import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrate.js';
import { seedTaxonomy } from './seed-taxonomy.js';
import { startTestDb, type TestDb } from './test-db.js';

describe('migrations', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  it('applies from scratch, reverts, and re-applies (up → down → up)', async () => {
    const tables = async () =>
      (
        await t.pool.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
        )
      ).rows[0]!.n;
    expect(Number(await tables())).toBeGreaterThan(15);
    expect(await migrateDown(t.pool)).toBe('0001_triggers_views.sql');
    expect(await migrateDown(t.pool)).toBe('0000_init.sql');
    expect(await tables()).toBe('1'); // schema_migrations only
    expect(await migrateUp(t.pool)).toEqual(['0000_init.sql', '0001_triggers_views.sql']);
    expect(await migrateUp(t.pool)).toEqual([]);
  });

  it('seeds the taxonomy idempotently', async () => {
    const first = await seedTaxonomy(t.db);
    const second = await seedTaxonomy(t.db);
    expect(first.rules).toBeGreaterThan(30);
    expect(second.rules).toBe(0);
    const { rows } = await t.pool.query<{ slug: string; parent: string | null }>(
      'SELECT c.slug, p.slug AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.slug = $1',
      ['food.groceries'],
    );
    expect(rows[0]?.parent).toBe('food');
  });

  it('forbids upgrading sources.hash_kind back to identifier', async () => {
    const { rows } = await t.pool.query<{ id: string }>(
      "INSERT INTO sources (kind, display_name) VALUES ('file', 'x') RETURNING id",
    );
    const id = rows[0]!.id;
    await t.pool.query("UPDATE sources SET hash_kind = 'fields' WHERE id = $1", [id]);
    const after = await t.pool.query<{ hash_kind_downgraded_at: string | null }>(
      'SELECT hash_kind_downgraded_at FROM sources WHERE id = $1',
      [id],
    );
    expect(after.rows[0]!.hash_kind_downgraded_at).not.toBeNull();
    await expect(
      t.pool.query("UPDATE sources SET hash_kind = 'identifier' WHERE id = $1", [id]),
    ).rejects.toThrow(/cannot be upgraded/);
  });
});
