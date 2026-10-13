/** Builds the API against a fresh migrated test database with the taxonomy seeded and a logged-in session. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedTaxonomy } from '@pinkas/db';
import { startTestDb, type TestDb } from '@pinkas/db/test-db';

process.env['SESSION_SECRET'] ??= 'test-secret-'.repeat(4);
process.env['DATABASE_URL'] ??= 'postgres://unused@localhost:5432/unused';
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'fatal';

export const H = { 'x-pinkas-request': '1' } as const;

export async function startTestApp() {
  const { buildApp } = await import('./app.js');
  const t: TestDb = await startTestDb();
  await seedTaxonomy(t.db);
  const uploadDir = await mkdtemp(join(tmpdir(), 'pinkas-uploads-'));
  const app = await buildApp({ pool: t.pool, uploadDir });
  const setup = await app.inject({
    method: 'POST',
    url: '/auth/setup',
    headers: H,
    payload: { password: 'correct horse battery' },
  });
  const cookie = setup.cookies.find((c) => c.name === 'pinkas_session');
  if (!cookie) throw new Error(`setup failed: ${setup.body}`);
  const auth = { ...H, cookie: `pinkas_session=${cookie.value}` };
  return {
    app,
    db: t.db,
    pool: t.pool,
    auth,
    async stop() {
      await app.close();
      await t.stop();
    },
  };
}
