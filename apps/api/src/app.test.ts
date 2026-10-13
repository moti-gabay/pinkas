import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['SESSION_SECRET'] = 'x'.repeat(40);
process.env['DATABASE_URL'] = 'postgres://u:p@localhost:5432/test';
process.env['NODE_ENV'] = 'test';
const { buildApp } = await import('./app.js');

describe('app', () => {
  const appP = buildApp();
  beforeAll(async () => {
    await appP;
  });
  afterAll(async () => {
    await (await appP).close();
  });

  it('serves /healthz', async () => {
    const res = await (await appP).inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'api' });
  });
  it('rejects mutating requests without the CSRF header', async () => {
    const res = await (await appP).inject({ method: 'POST', url: '/healthz' });
    expect(res.statusCode).toBe(403);
  });
});
