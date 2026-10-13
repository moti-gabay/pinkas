import { schema } from '@pinkas/db';
import { proposeLearnedRule } from '@pinkas/domain';
import {
  PinkasError,
  transactionDto,
  transactionsPage,
  transactionsQuery,
  updateTransactionBody,
  uuid,
} from '@pinkas/shared';
import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const t = schema.transactions;

export const toTransactionDto = (r: typeof t.$inferSelect) => ({
  id: r.id,
  accountId: r.accountId,
  txnDate: r.txnDate,
  processedDate: r.processedDate,
  chargedAmountAgorot: r.chargedAmountAgorot,
  originalAmountMinor: r.originalAmountMinor,
  originalCurrency: r.originalCurrency,
  status: r.status,
  descriptionRaw: r.descriptionRaw,
  merchantNormalized: r.merchantNormalized,
  memo: r.memo,
  installmentNumber: r.installmentNumber,
  installmentTotal: r.installmentTotal,
  categoryId: r.categoryId,
  categorySource: r.categorySource,
  categoryConfidence: r.categoryConfidence === null ? null : Number(r.categoryConfidence),
  isFixed: r.isFixed,
  excludeReason: r.excludeReason,
  stalePending: r.stalePending,
  notes: r.notes,
  tags: r.tags,
});

export const transactionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/transactions',
    { schema: { querystring: transactionsQuery, response: { 200: transactionsPage } } },
    async (req) => {
      const q = req.query;
      const conds: SQL[] = [];
      if (q.from) conds.push(gte(t.txnDate, q.from));
      if (q.to) conds.push(lte(t.txnDate, q.to));
      if (q.accountId) conds.push(eq(t.accountId, q.accountId));
      if (q.categoryId) conds.push(eq(t.categoryId, q.categoryId));
      if (q.tag) conds.push(sql`${q.tag} = ANY(${t.tags})`);
      if (!q.includeExcluded) conds.push(isNull(t.excludeReason));
      if (q.uncategorized)
        conds.push(sql`(${t.categorySource} = 'default' OR ${t.categoryId} IS NULL)`);
      if (q.q) {
        const needle = `%${q.q.replace(/[%_]/g, '')}%`;
        conds.push(
          sql`(${t.descriptionRaw} ILIKE ${needle} OR ${t.merchantNormalized} ILIKE ${needle} OR ${t.notes} ILIKE ${needle})`,
        );
      }
      const where = conds.length ? and(...conds) : undefined;
      const order = {
        date_desc: [desc(t.txnDate), desc(t.createdAt)],
        date_asc: [asc(t.txnDate), asc(t.createdAt)],
        amount_desc: [desc(t.chargedAmountAgorot)],
        amount_asc: [asc(t.chargedAmountAgorot)],
      }[q.sort];
      const [items, totalRow] = await Promise.all([
        app.db
          .select()
          .from(t)
          .where(where)
          .orderBy(...order)
          .limit(q.limit)
          .offset(q.offset),
        app.db
          .select({ n: sql<number>`count(*)::int` })
          .from(t)
          .where(where),
      ]);
      return { items: items.map(toTransactionDto), total: totalRow[0]?.n ?? 0 };
    },
  );

  app.get(
    '/transactions/:id',
    { schema: { params: z.object({ id: uuid }), response: { 200: transactionDto } } },
    async (req) => {
      const row = await app.db.query.transactions.findFirst({ where: eq(t.id, req.params.id) });
      if (!row) throw new PinkasError('NOT_FOUND', 'transaction not found');
      return toTransactionDto(row);
    },
  );

  /**
   * Manual edits. A category change is recorded as `manual` (never overwritten by rules/AI) and the
   * response proposes a learned rule for the merchant so the UI can offer "save as rule".
   */
  app.patch(
    '/transactions/:id',
    {
      schema: {
        params: z.object({ id: uuid }),
        body: updateTransactionBody,
        response: {
          200: z.object({
            transaction: transactionDto,
            proposedRule: z
              .object({
                pattern: z.string(),
                match: z.string(),
                field: z.string(),
                categoryId: uuid,
                alreadyExists: z.boolean(),
              })
              .nullable(),
          }),
        },
      },
    },
    async (req) => {
      const b = req.body;
      const patch: Partial<typeof t.$inferInsert> = {};
      if (b.categoryId !== undefined)
        Object.assign(patch, {
          categoryId: b.categoryId,
          categorySource: b.categoryId === null ? null : 'manual',
          categoryRuleId: null,
          categoryConfidence: null,
        });
      if (b.isFixed !== undefined) patch.isFixed = b.isFixed;
      if (b.notes !== undefined) patch.notes = b.notes;
      if (b.tags !== undefined) patch.tags = [...new Set(b.tags)];
      if (b.excludeReason !== undefined) patch.excludeReason = b.excludeReason;
      const [row] = await app.db.update(t).set(patch).where(eq(t.id, req.params.id)).returning();
      if (!row) throw new PinkasError('NOT_FOUND', 'transaction not found');
      let proposedRule = null;
      if (b.categoryId) {
        const proposal = proposeLearnedRule(
          { merchantNormalized: row.merchantNormalized },
          b.categoryId,
        );
        const existing = await app.db.query.categoryRules.findFirst({
          where: and(
            eq(schema.categoryRules.pattern, proposal.pattern),
            eq(schema.categoryRules.match, 'exact'),
            eq(schema.categoryRules.field, 'merchant_normalized'),
          ),
        });
        proposedRule = { ...proposal, alreadyExists: existing !== undefined };
      }
      return { transaction: toTransactionDto(row), proposedRule };
    },
  );

  app.delete('/transactions/:id', { schema: { params: z.object({ id: uuid }) } }, async (req) => {
    const deleted = await app.db
      .delete(t)
      .where(and(eq(t.id, req.params.id), eq(t.origin, 'manual')))
      .returning({ id: t.id });
    if (deleted.length === 0)
      throw new PinkasError('NOT_FOUND', 'only manual transactions can be deleted');
    return { ok: true };
  });
};
