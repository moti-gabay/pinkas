/** `pnpm --filter @pinkas/api seed:demo` — fills the database with the synthetic household for dashboard development. */
import { createDb, createPool, seedTaxonomy } from '@pinkas/db';
import { loadHousehold } from './services/demo-data.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const pool = createPool(url);
try {
  const db = createDb(pool);
  await seedTaxonomy(db);
  const res = await loadHousehold(db);
  process.stdout.write(
    `demo data loaded: ${res.household.transactions.length} fixture rows, ${res.rowsAdded} inserted\n`,
  );
} finally {
  await pool.end();
}
