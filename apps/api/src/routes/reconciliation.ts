import { relink, schema } from '@pinkas/db';
import { PinkasError, uuid } from '@pinkas/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const t = schema.transactions;

export const reconciliationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/reconciliation', async () => {
    const accounts = await app.db
      .select({
        id: schema.accounts.id,
        label: schema.accounts.maskedLabel,
        name: schema.accounts.displayName,
      })
      .from(schema.accounts);
    const labelOf = (id: string) => {
      const a = accounts.find((x) => x.id === id);
      return a ? `${a.name} ${a.label}` : '';
    };
    const settlementRows = await app.db
      .select({
        s: schema.cardSettlements,
        txnDate: t.txnDate,
        amount: t.chargedAmountAgorot,
        description: t.descriptionRaw,
      })
      .from(schema.cardSettlements)
      .innerJoin(t, eq(t.id, schema.cardSettlements.bankTxnId))
      .orderBy(desc(schema.cardSettlements.cycleDate));
    const from = alias(t, 'from_txn');
    const to = alias(t, 'to_txn');
    const transferRows = await app.db
      .select({ link: schema.transactionLinks, from, to })
      .from(schema.transactionLinks)
      .innerJoin(from, eq(from.id, schema.transactionLinks.fromTxnId))
      .innerJoin(to, eq(to.id, schema.transactionLinks.toTxnId))
      .where(eq(schema.transactionLinks.kind, 'transfer'))
      .orderBy(desc(from.txnDate));
    const stale = await app.db
      .select()
      .from(t)
      .where(and(eq(t.status, 'pending'), eq(t.stalePending, true)));
    const leg = (r: typeof t.$inferSelect) => ({
      txnId: r.id,
      accountLabel: labelOf(r.accountId),
      txnDate: r.txnDate,
      amountAgorot: r.chargedAmountAgorot,
      description: r.descriptionRaw,
    });
    return {
      settlements: settlementRows.map((r) => ({
        id: r.s.id,
        bankTxnId: r.s.bankTxnId,
        bankTxnDate: r.txnDate,
        bankAmountAgorot: r.amount,
        bankDescription: r.description,
        cardAccountId: r.s.cardAccountId,
        cardAccountLabel: labelOf(r.s.cardAccountId),
        cycleDate: r.s.cycleDate,
        expectedTotalAgorot: r.s.expectedTotalAgorot,
        diffAgorot: r.s.diffAgorot,
        status: r.s.status,
      })),
      transfers: transferRows
        .filter((r) => Number(r.link.confidence ?? 1) > 0)
        .map((r) => ({
          linkId: r.link.id,
          confidence: Number(r.link.confidence ?? 0),
          createdBy: r.link.createdBy,
          from: leg(r.from),
          to: leg(r.to),
        })),
      stalePending: stale.map(leg),
    };
  });

  app.post(
    '/reconciliation/transfers/:linkId/confirm',
    { schema: { params: z.object({ linkId: uuid }) } },
    async (req) => {
      const [row] = await app.db
        .update(schema.transactionLinks)
        .set({ createdBy: 'user' })
        .where(
          and(
            eq(schema.transactionLinks.id, req.params.linkId),
            eq(schema.transactionLinks.kind, 'transfer'),
          ),
        )
        .returning();
      if (!row) throw new PinkasError('NOT_FOUND', 'link not found');
      return { ok: true };
    },
  );

  /**
   * Unlink: both legs count again. The link row is kept, owned by the user, with confidence 0 so that
   * relink treats the legs as pinned and never auto-pairs them again.
   */
  app.delete(
    '/reconciliation/transfers/:linkId',
    { schema: { params: z.object({ linkId: uuid }) } },
    async (req) => {
      const [row] = await app.db
        .update(schema.transactionLinks)
        .set({ createdBy: 'user', confidence: '0.00' })
        .where(
          and(
            eq(schema.transactionLinks.id, req.params.linkId),
            eq(schema.transactionLinks.kind, 'transfer'),
          ),
        )
        .returning();
      if (!row) throw new PinkasError('NOT_FOUND', 'link not found');
      await app.db
        .update(t)
        .set({ excludeReason: null })
        .where(
          and(
            inArray(t.id, [row.fromTxnId, row.toTxnId]),
            eq(t.excludeReason, 'internal_transfer'),
          ),
        );
      return { ok: true };
    },
  );

  app.post('/reconciliation/relink', async () => relink(app.db));
};
