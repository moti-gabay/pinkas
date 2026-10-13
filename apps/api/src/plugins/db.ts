import { createDb, createPool, type Db } from '@pinkas/db';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import type pg from 'pg';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    pool: pg.Pool;
  }
}

export interface DbPluginOptions {
  databaseUrl?: string;
  pool?: pg.Pool; // tests inject a pool
}

const plugin: FastifyPluginAsync<DbPluginOptions> = async (app, opts) => {
  const pool = opts.pool ?? createPool(opts.databaseUrl ?? '');
  app.decorate('pool', pool);
  app.decorate('db', createDb(pool));
  if (!opts.pool)
    app.addHook('onClose', async () => {
      await pool.end();
    });
};

export const dbPlugin = fp(plugin, { name: 'db' });
