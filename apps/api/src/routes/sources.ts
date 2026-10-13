import { schema } from '@pinkas/db';
import {
  accountDto,
  createFileSourceBody,
  sourceDto,
  updateAccountBody,
  uuid,
} from '@pinkas/shared';
import { PinkasError } from '@pinkas/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export function maskAccount(externalId: string): string {
  const digits = externalId.replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : '****';
}

const toSourceDto = (s: typeof schema.sources.$inferSelect) => ({
  id: s.id,
  kind: s.kind,
  companyId: s.companyId as never,
  displayName: s.displayName,
  enabled: s.enabled,
  hashKind: s.hashKind,
  lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
  lastErrorType: s.lastErrorType,
  lastErrorAt: s.lastErrorAt?.toISOString() ?? null,
});
export const toAccountDto = (a: typeof schema.accounts.$inferSelect) => ({
  id: a.id,
  sourceId: a.sourceId,
  maskedLabel: a.maskedLabel,
  type: a.type,
  currency: a.currency,
  displayName: a.displayName,
  isActive: a.isActive,
  balanceAgorot: a.balanceAgorot,
  balanceAt: a.balanceAt?.toISOString() ?? null,
  cardCycleDay: a.cardCycleDay,
});

export const sourceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/sources', { schema: { response: { 200: z.array(sourceDto) } } }, async () => {
    const rows = await app.db.select().from(schema.sources).orderBy(desc(schema.sources.createdAt));
    return rows.map(toSourceDto);
  });

  /** File-based source + its one account (scraper sources are created in phase 2 with credentials). */
  app.post(
    '/sources/file',
    {
      schema: {
        body: createFileSourceBody,
        response: { 201: z.object({ source: sourceDto, account: accountDto }) },
      },
    },
    async (req, reply) => {
      const { displayName, account } = req.body;
      const result = await app.db.transaction(async (tx) => {
        const [source] = await tx
          .insert(schema.sources)
          .values({ kind: 'file', displayName, hashKind: 'identifier' })
          .returning();
        if (!source) throw new Error('insert failed');
        const [acc] = await tx
          .insert(schema.accounts)
          .values({
            sourceId: source.id,
            externalId: account.externalId,
            maskedLabel: maskAccount(account.externalId),
            type: account.type,
            displayName: account.displayName,
            cardCycleDay: account.cardCycleDay ?? null,
          })
          .returning();
        if (!acc) throw new Error('insert failed');
        return { source, account: acc };
      });
      return reply
        .code(201)
        .send({ source: toSourceDto(result.source), account: toAccountDto(result.account) });
    },
  );

  app.delete('/sources/:id', { schema: { params: z.object({ id: uuid }) } }, async (req) => {
    const deleted = await app.db
      .delete(schema.sources)
      .where(eq(schema.sources.id, req.params.id))
      .returning({ id: schema.sources.id });
    if (deleted.length === 0) throw new PinkasError('NOT_FOUND', 'source not found');
    return { ok: true };
  });

  app.get('/accounts', { schema: { response: { 200: z.array(accountDto) } } }, async () => {
    const rows = await app.db.select().from(schema.accounts).orderBy(schema.accounts.displayName);
    return rows.map(toAccountDto);
  });

  app.patch(
    '/accounts/:id',
    {
      schema: {
        params: z.object({ id: uuid }),
        body: updateAccountBody,
        response: { 200: accountDto },
      },
    },
    async (req) => {
      const [row] = await app.db
        .update(schema.accounts)
        .set(req.body)
        .where(eq(schema.accounts.id, req.params.id))
        .returning();
      if (!row) throw new PinkasError('NOT_FOUND', 'account not found');
      return toAccountDto(row);
    },
  );
};
