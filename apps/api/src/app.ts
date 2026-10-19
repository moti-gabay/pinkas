import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { PinkasError } from '@pinkas/shared';
import Fastify, { type FastifyError } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type pg from 'pg';
import { config } from './config.js';
import { ImportService } from './import/service.js';
import { logger } from './logger.js';
import { authPlugin } from './plugins/auth.js';
import { dbPlugin } from './plugins/db.js';
import { authRoutes } from './routes/auth.js';
import { categoryRoutes } from './routes/categories.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/imports.js';
import { reconciliationRoutes } from './routes/reconciliation.js';
import { reportRoutes } from './routes/reports.js';
import { sourceRoutes } from './routes/sources.js';
import { syncRoutes } from './routes/sync.js';
import { transactionRoutes } from './routes/transactions.js';

export interface BuildOptions {
  pool?: pg.Pool;
  uploadDir?: string;
}

const PUBLIC_PREFIXES = ['/healthz', '/auth/'];

export async function buildApp(opts: BuildOptions = {}) {
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
  await app.register(multipart, {
    limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1, fields: 5 },
  });
  await app.register(
    dbPlugin,
    opts.pool ? { pool: opts.pool } : { databaseUrl: config.DATABASE_URL },
  );
  await app.register(authPlugin);

  // CSRF: cookies are SameSite=Strict; additionally every mutating request must carry a custom header
  // that browsers never add cross-origin, and its Origin (when present) must be local.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    const originOk =
      origin === undefined || ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname);
    if (!originOk || req.headers['x-pinkas-request'] !== '1') {
      await reply.code(403).send({ code: 'FORBIDDEN', message: 'בקשה לא חוקית' });
    }
  });

  app.addHook('onRequest', async (req, reply) => {
    if (PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
    await app.auth.requireSession(req, reply);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof PinkasError) {
      req.log.warn({ code: err.code, err: err.message, details: err.details }, 'request failed');
      return reply
        .code(err.status)
        .send({ code: err.code, message: err.messageHe, details: err.details });
    }
    if (err.validation !== undefined) {
      req.log.info({ validation: err.validation }, 'validation failed');
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

  const importService = new ImportService(
    app.db,
    opts.uploadDir ?? config.UPLOAD_DIR,
    config.UPLOAD_MAX_BYTES,
  );
  app.decorate('imports', importService);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(sourceRoutes);
  await app.register(syncRoutes);
  await app.register(categoryRoutes);
  await app.register(transactionRoutes);
  await app.register(reportRoutes);
  await app.register(reconciliationRoutes);
  await app.register(importRoutes(importService));
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    imports: ImportService;
  }
}
