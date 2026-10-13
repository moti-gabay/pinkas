import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PinkasError } from '@pinkas/shared';
import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config } from './config.js';
import { logger } from './logger.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: false,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // CSRF: cookies are SameSite=Strict; additionally every mutating request must carry a custom header
  // that browsers never add cross-origin, and its Origin (when present) must be ours.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    const originOk =
      origin === undefined ||
      new URL(origin).hostname === '127.0.0.1' ||
      new URL(origin).hostname === 'localhost';
    if (!originOk || req.headers['x-pinkas-request'] !== '1') {
      await reply.code(403).send({ code: 'FORBIDDEN', message: 'בקשה לא חוקית' });
    }
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof PinkasError) {
      req.log.warn({ code: err.code, err: err.message, details: err.details }, 'request failed');
      return reply.code(err.status).send({ code: err.code, message: err.messageHe });
    }
    if (err.validation !== undefined) {
      return reply.code(400).send({ code: 'VALIDATION', message: 'הנתונים שהוזנו אינם תקינים' });
    }
    if (err.statusCode === 429) {
      return reply
        .code(429)
        .send({ code: 'RATE_LIMITED', message: 'יותר מדי ניסיונות, נסה שוב מאוחר יותר' });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ code: 'INTERNAL', message: 'אירעה שגיאה פנימית' });
  });

  await app.register(healthRoutes);
  return app;
}
