import { schema } from '@pinkas/db';
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
});
