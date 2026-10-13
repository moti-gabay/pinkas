import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { H, startTestApp } from './test-app.js';

describe('api', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => {
    t = await startTestApp();
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  });

  it('serves /healthz without auth', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ ok: true, service: 'api' });
  });
  it('rejects mutating requests without the CSRF header and unauthenticated reads', async () => {
    expect(
      (await t.app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'x' } }))
        .statusCode,
    ).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/accounts' })).statusCode).toBe(401);
  });
  it('rejects a wrong password and never returns a stack trace', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: H,
      payload: { password: 'wrong password!' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toMatch(/at .*\.ts/);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('creates a file source with an account and lists categories', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/sources/file',
      headers: t.auth,
      payload: {
        displayName: 'פפר',
        account: { displayName: 'עו"ש פפר', type: 'checking', externalId: '12-345-678901' },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().account.maskedLabel).toBe('****8901');
    const cats = await t.app.inject({ method: 'GET', url: '/categories', headers: t.auth });
    expect(cats.json().length).toBeGreaterThan(40);
  });
});
