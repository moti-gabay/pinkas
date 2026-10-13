import { schema } from '@pinkas/db';
import {
  PinkasError,
  createScraperSourceBody,
  credentialsBody,
  sourceDto,
  supportedCompanies,
  syncRunDto,
  uuid,
} from '@pinkas/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { config } from '../config.js';
import { sealCredentials } from '../credentials/seal.js';
import { toSourceDto } from './sources.js';

function requirePublicKey(): string {
  if (!config.CREDENTIALS_PUBLIC_KEY)
    throw new PinkasError(
      'CONFLICT',
      'CREDENTIALS_PUBLIC_KEY is not configured; run `pnpm pinkas keygen`',
    );
  return config.CREDENTIALS_PUBLIC_KEY;
}

function validateFields(
  companyId: keyof typeof supportedCompanies,
  credentials: Record<string, string>,
): void {
  const expected = [...supportedCompanies[companyId].loginFields].sort();
  const given = Object.keys(credentials).sort();
  if (expected.join(',') !== given.join(','))
    throw new PinkasError('VALIDATION', `expected fields ${expected.join(',')}`, {
      details: { expected },
    });
}

const toRunDto = (r: typeof schema.syncRuns.$inferSelect) => ({
  ...r,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

export const syncRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Creates a scraper source. Credentials are sealed with the public key and never returned by any endpoint. */
  app.post(
    '/sources/scraper',
    { schema: { body: createScraperSourceBody, response: { 201: sourceDto } } },
    async (req, reply) => {
      const publicKey = requirePublicKey();
      validateFields(req.body.companyId, req.body.credentials);
      const sealed = await sealCredentials(req.body.credentials, publicKey);
      const source = await app.db.transaction(async (tx) => {
        const [src] = await tx
          .insert(schema.sources)
          .values({
            kind: 'scraper',
            companyId: req.body.companyId,
            displayName: req.body.displayName,
            scheduleCron: req.body.scheduleCron ?? null,
          })
          .returning();
        if (!src) throw new Error('insert failed');
        await tx.insert(schema.credentials).values({
          sourceId: src.id,
          ciphertext: sealed.ciphertext,
          keyFingerprint: sealed.keyFingerprint,
        });
        return src;
      });
      return reply.code(201).send(toSourceDto(source));
    },
  );

  /** Re-enter credentials (after a login failure disabled the source) and re-enable it. */
  app.put(
    '/sources/:id/credentials',
    {
      schema: {
        params: z.object({ id: uuid }),
        body: z.object({ credentials: credentialsBody }),
        response: { 200: sourceDto },
      },
    },
    async (req) => {
      const publicKey = requirePublicKey();
      const source = await app.db.query.sources.findFirst({
        where: eq(schema.sources.id, req.params.id),
      });
      if (source?.kind !== 'scraper' || !source.companyId)
        throw new PinkasError('NOT_FOUND', 'scraper source not found');
      validateFields(source.companyId as keyof typeof supportedCompanies, req.body.credentials);
      const sealed = await sealCredentials(req.body.credentials, publicKey);
      const [updated] = await app.db.transaction(async (tx) => {
        await tx
          .insert(schema.credentials)
          .values({
            sourceId: source.id,
            ciphertext: sealed.ciphertext,
            keyFingerprint: sealed.keyFingerprint,
          })
          .onConflictDoUpdate({
            target: schema.credentials.sourceId,
            set: {
              ciphertext: sealed.ciphertext,
              keyFingerprint: sealed.keyFingerprint,
              updatedAt: new Date(),
            },
          });
        return tx
          .update(schema.sources)
          .set({ enabled: true, lastErrorType: null, lastErrorAt: null })
          .where(eq(schema.sources.id, source.id))
          .returning();
      });
      if (!updated) throw new Error('update failed');
      return toSourceDto(updated);
    },
  );

  app.patch(
    '/sources/:id',
    {
      schema: {
        params: z.object({ id: uuid }),
        body: z.object({
          displayName: z.string().min(1).max(100).optional(),
          enabled: z.boolean().optional(),
          scheduleCron: z.string().max(100).nullable().optional(),
        }),
        response: { 200: sourceDto },
      },
    },
    async (req) => {
      const [updated] = await app.db
        .update(schema.sources)
        .set(req.body)
        .where(eq(schema.sources.id, req.params.id))
        .returning();
      if (!updated) throw new PinkasError('NOT_FOUND', 'source not found');
      return toSourceDto(updated);
    },
  );

  /** "Sync now": a queued run row that the worker claims. Only one pending run per source. */
  app.post(
    '/sources/:id/sync',
    { schema: { params: z.object({ id: uuid }), response: { 202: syncRunDto } } },
    async (req, reply) => {
      const source = await app.db.query.sources.findFirst({
        where: eq(schema.sources.id, req.params.id),
      });
      if (source?.kind !== 'scraper')
        throw new PinkasError('NOT_FOUND', 'scraper source not found');
      if (!source.enabled)
        throw new PinkasError('CONFLICT', 'source is disabled; re-enter credentials first');
      const pending = await app.db.query.syncRuns.findFirst({
        where: and(
          eq(schema.syncRuns.sourceId, source.id),
          inArray(schema.syncRuns.status, ['queued', 'running']),
        ),
      });
      if (pending) return reply.code(202).send(toRunDto(pending));
      const [run] = await app.db
        .insert(schema.syncRuns)
        .values({ sourceId: source.id, trigger: 'manual', status: 'queued' })
        .returning();
      if (!run) throw new Error('insert failed');
      return reply.code(202).send(toRunDto(run));
    },
  );

  app.get(
    '/sync-runs',
    {
      schema: {
        querystring: z.object({
          sourceId: uuid.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.array(syncRunDto) },
      },
    },
    async (req) => {
      const rows = await app.db
        .select()
        .from(schema.syncRuns)
        .where(req.query.sourceId ? eq(schema.syncRuns.sourceId, req.query.sourceId) : undefined)
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(req.query.limit);
      return rows.map(toRunDto);
    },
  );
};
