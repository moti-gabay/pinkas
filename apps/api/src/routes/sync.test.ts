import { createDb, recordSourceOutcome, schema, type Db } from '@pinkas/db';
import { eq } from 'drizzle-orm';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from '../test-app.js';

describe('scraper sources and sync requests', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => {
    await sodium.ready;
    const kp = sodium.crypto_box_keypair();
    process.env['CREDENTIALS_PUBLIC_KEY'] = sodium.to_base64(
      kp.publicKey,
      sodium.base64_variants.ORIGINAL,
    );
    t = await startTestApp();
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  it('creates a scraper source with sealed credentials that no endpoint returns', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/sources/scraper',
      headers: t.auth,
      payload: {
        companyId: 'beinleumi',
        displayName: 'בינלאומי',
        credentials: { username: 'moti', password: 'hunter22' },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('hunter22');
    const sources = await t.app.inject({ method: 'GET', url: '/sources', headers: t.auth });
    expect(sources.body).not.toContain('hunter22');
    const stored = await t.db.select().from(schema.credentials);
    expect(stored).toHaveLength(1);
    expect(Buffer.from(stored[0]!.ciphertext).toString('utf8')).not.toContain('hunter22');
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/sources/scraper',
      headers: t.auth,
      payload: {
        companyId: 'isracard',
        displayName: 'x',
        credentials: { username: 'a', password: 'b' },
      },
    });
    expect(wrong.statusCode).toBe(400);
  });

  it("the API's own database handle cannot read the ciphertext it just stored", async () => {
    await expect(t.app.db.select().from(schema.credentials)).rejects.toThrow();
    await expect(t.app.pool.query('SELECT ciphertext FROM credentials')).rejects.toThrow(
      /permission denied/,
    );
    const meta = await t.app.pool.query('SELECT source_id, key_fingerprint FROM credentials');
    expect(meta.rowCount).toBe(1);
  });

  it('queues a manual sync once and lists runs', async () => {
    const id = (await t.app.inject({ method: 'GET', url: '/sources', headers: t.auth })).json<
      { id: string }[]
    >()[0]!.id;
    const a = await t.app.inject({ method: 'POST', url: `/sources/${id}/sync`, headers: t.auth });
    const b = await t.app.inject({ method: 'POST', url: `/sources/${id}/sync`, headers: t.auth });
    expect(a.statusCode).toBe(202);
    expect(a.json().id).toBe(b.json().id);
    const runs = await t.app.inject({
      method: 'GET',
      url: `/sync-runs?sourceId=${id}`,
      headers: t.auth,
    });
    expect(runs.json()).toHaveLength(1);
    expect(runs.json()[0]).toMatchObject({ status: 'queued', trigger: 'manual' });
  });

  describe('re-enabling a source disabled by a login failure', () => {
    // Worker writes go through the worker's own DB function and role, exactly as in production.
    let worker: Db;
    beforeAll(async () => {
      worker = createDb(await t.asRole('pinkas_worker'));
    });

    async function loginDisabledSource(errorType: string) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/sources/scraper',
        headers: t.auth,
        payload: {
          companyId: 'max',
          displayName: `max ${errorType}`,
          credentials: { username: 'u', password: 'wrong' },
        },
      });
      const id = res.json<{ id: string }>().id;
      // What syncSource does on a login-class result.
      await worker.update(schema.sources).set({ enabled: false }).where(eq(schema.sources.id, id));
      await recordSourceOutcome(worker, id, errorType);
      return id;
    }
    const patch = (id: string, payload: object) =>
      t.app.inject({ method: 'PATCH', url: `/sources/${id}`, headers: t.auth, payload });
    const source = async (id: string) =>
      t.db.query.sources.findFirst({ where: eq(schema.sources.id, id) });

    it('PATCH {enabled:true} is refused with 409 and the source stays disabled', async () => {
      const id = await loginDisabledSource('INVALID_PASSWORD');
      expect((await patch(id, { enabled: true })).statusCode).toBe(409);
      expect((await patch(id, { displayName: 'renamed', enabled: true })).statusCode).toBe(409);
      expect(await source(id)).toMatchObject({
        enabled: false,
        displayName: 'max INVALID_PASSWORD',
      });
    });

    it('stays 409 after a queued run hits the disabled source (DISABLED / NO_CREDENTIALS)', async () => {
      const id = await loginDisabledSource('ACCOUNT_BLOCKED');
      // The race: a manual run was queued while the source was still enabled, and the worker closes it later.
      await recordSourceOutcome(worker, id, 'DISABLED');
      await recordSourceOutcome(worker, id, 'NO_CREDENTIALS');
      expect((await source(id))?.lastErrorType).toBe('ACCOUNT_BLOCKED');
      expect((await patch(id, { enabled: true })).statusCode).toBe(409);
    });

    it('PUT credentials clears the marker and re-enables the source', async () => {
      const id = await loginDisabledSource('CHANGE_PASSWORD');
      const put = await t.app.inject({
        method: 'PUT',
        url: `/sources/${id}/credentials`,
        headers: t.auth,
        payload: { credentials: { username: 'u', password: 'new-password' } },
      });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toMatchObject({ enabled: true, lastErrorType: null });
      expect((await patch(id, { enabled: false })).statusCode).toBe(200);
      expect((await patch(id, { enabled: true })).statusCode).toBe(200);
    });

    it('a non-login failure does not block a plain re-enable', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/sources/scraper',
        headers: t.auth,
        payload: {
          companyId: 'visaCal',
          displayName: 'cal',
          credentials: { username: 'u', password: 'p' },
        },
      });
      const id = res.json<{ id: string }>().id;
      await recordSourceOutcome(worker, id, 'TIMEOUT');
      expect((await patch(id, { enabled: false })).statusCode).toBe(200);
      await recordSourceOutcome(worker, id, 'DISABLED');
      expect((await patch(id, { enabled: true })).statusCode).toBe(200);
    });
  });
});
