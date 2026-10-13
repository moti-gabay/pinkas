import { authStatus, passwordBody } from '@pinkas/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SESSION_COOKIE } from '../plugins/auth.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/auth/status', { schema: { response: { 200: authStatus } } }, async (req) => {
    const setupRequired = !(await app.auth.isSetup());
    let authenticated = false;
    if (!setupRequired && req.cookies[SESSION_COOKIE]) {
      try {
        await app.auth.requireSession(req, undefined as never);
        authenticated = true;
      } catch {
        authenticated = false;
      }
    }
    return { authenticated, setupRequired };
  });

  app.post(
    '/auth/setup',
    { schema: { body: passwordBody }, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      await app.auth.setPassword(req.body.password);
      await app.auth.login(req.body.password, reply);
      return { ok: true };
    },
  );

  app.post(
    '/auth/login',
    { schema: { body: passwordBody }, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      await app.auth.login(req.body.password, reply);
      return { ok: true };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    await app.auth.logout(req, reply);
    return { ok: true };
  });
};
