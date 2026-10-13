import { readFileSync } from 'node:fs';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Builds a pool from DATABASE_URL. The password may come from a docker secret file (PGPASSWORD_FILE)
 * so that no role password ever appears in the environment or compose file.
 */
export function createPool(
  databaseUrl: string,
  passwordFile = process.env['PGPASSWORD_FILE'],
): pg.Pool {
  const url = new URL(databaseUrl);
  if (passwordFile && !url.password)
    url.password = encodeURIComponent(readFileSync(passwordFile, 'utf8').trim());
  // bigint columns are read as JS numbers: all amounts are agorot well inside the safe-integer range.
  pg.types.setTypeParser(pg.types.builtins.INT8, (v) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new RangeError(`bigint out of safe range: ${v}`);
    return n;
  });
  pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v); // DATE as 'YYYY-MM-DD' string, never a JS Date
  return new pg.Pool({ connectionString: url.toString(), max: 10 });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export { schema };
