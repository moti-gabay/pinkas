import { createDb, createPool } from './client.js';
import { seedTaxonomy } from './seed-taxonomy.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is required');
const pool = createPool(url);
try {
  const res = await seedTaxonomy(createDb(pool));
  process.stdout.write(`seeded taxonomy: ${res.categories} categories, ${res.rules} new rules\n`);
} finally {
  await pool.end();
}
