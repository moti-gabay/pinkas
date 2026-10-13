/**
 * Relink: after every sync or import, (re)derive the links that keep totals honest:
 *  - card settlements: bank debits paying a card cycle are excluded from spending
 *  - own-account transfers: both legs excluded
 *  - refunds: inherit the original purchase's category
 * User decisions (links created_by 'user', exclude_reason 'user', manual categories) are never overridden.
 */
import { buildCycles, detectTransfers, matchRefunds, matchSettlements } from '@pinkas/domain';
import { and, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import * as schema from './schema/index.js';

export interface RelinkResult {
  settlements: number;
  transfers: number;
  refunds: number;
}

const t = schema.transactions;

export async function relink(db: Db): Promise<RelinkResult> {
  return db.transaction(async (tx) => {
    const accounts = await tx.select().from(schema.accounts);
    const sources = await tx
      .select({ id: schema.sources.id, companyId: schema.sources.companyId })
      .from(schema.sources);
    const companyOf = new Map(sources.map((s) => [s.id, s.companyId ?? undefined]));
    const cardIds = accounts.filter((a) => a.type === 'credit_card').map((a) => a.id);
    const bankIds = accounts.filter((a) => a.type !== 'credit_card').map((a) => a.id);
    const issuerOfCard = (cardAccountId: string) =>
      companyOf.get(accounts.find((a) => a.id === cardAccountId)?.sourceId ?? '');
    const digitsOf = (accountId: string) =>
      accounts
        .find((a) => a.id === accountId)
        ?.externalId.replace(/\D/g, '')
        .slice(-4);

    // --- card settlements -------------------------------------------------------------------------
    let settlements = 0;
    if (cardIds.length && bankIds.length) {
      const cardRows = await tx
        .select({
          accountId: t.accountId,
          processedDate: t.processedDate,
          txnDate: t.txnDate,
          chargedAmountAgorot: t.chargedAmountAgorot,
        })
        .from(t)
        .where(inArray(t.accountId, cardIds));
      const cycles = buildCycles(
        cardRows.map((r) => ({ ...r, processedDate: r.processedDate ?? undefined })),
      );
      const debits = await tx
        .select({
          id: t.id,
          txnDate: t.txnDate,
          chargedAmountAgorot: t.chargedAmountAgorot,
          merchantNormalized: t.merchantNormalized,
        })
        .from(t)
        .where(
          and(
            inArray(t.accountId, bankIds),
            lt(t.chargedAmountAgorot, 0),
            or(isNull(t.excludeReason), eq(t.excludeReason, 'card_settlement')),
          ),
        );
      const matches = matchSettlements(debits, cycles, issuerOfCard);
      // Recompute from scratch: settlements are a pure function of the ledger.
      await tx.delete(schema.cardSettlements);
      await tx.update(t).set({ excludeReason: null }).where(eq(t.excludeReason, 'card_settlement'));
      for (const m of matches) {
        await tx.insert(schema.cardSettlements).values({
          bankTxnId: m.bankTxnId,
          cardAccountId: m.cardAccountId,
          cycleDate: m.cycleDate,
          expectedTotalAgorot: m.expectedTotalAgorot,
          status: m.status,
          diffAgorot: m.diffAgorot,
        });
        await tx.update(t).set({ excludeReason: 'card_settlement' }).where(eq(t.id, m.bankTxnId));
      }
      settlements = matches.length;
    }

    // --- own-account transfers --------------------------------------------------------------------
    let transfers = 0;
    if (bankIds.length > 1) {
      const userLinks = await tx
        .select({
          fromTxnId: schema.transactionLinks.fromTxnId,
          toTxnId: schema.transactionLinks.toTxnId,
        })
        .from(schema.transactionLinks)
        .where(
          and(
            eq(schema.transactionLinks.kind, 'transfer'),
            eq(schema.transactionLinks.createdBy, 'user'),
          ),
        );
      const pinned = new Set(userLinks.flatMap((l) => [l.fromTxnId, l.toTxnId]));
      const legs = await tx
        .select({
          id: t.id,
          accountId: t.accountId,
          txnDate: t.txnDate,
          chargedAmountAgorot: t.chargedAmountAgorot,
          descriptionRaw: t.descriptionRaw,
        })
        .from(t)
        .where(
          and(
            inArray(t.accountId, bankIds),
            or(isNull(t.excludeReason), eq(t.excludeReason, 'internal_transfer')),
          ),
        );
      const pairs = detectTransfers(
        legs.filter((l) => !pinned.has(l.id)),
        digitsOf,
      );
      await tx
        .delete(schema.transactionLinks)
        .where(
          and(
            eq(schema.transactionLinks.kind, 'transfer'),
            eq(schema.transactionLinks.createdBy, 'system'),
          ),
        );
      const systemLinked = legs.filter((l) => !pinned.has(l.id)).map((l) => l.id);
      if (systemLinked.length)
        await tx
          .update(t)
          .set({ excludeReason: null })
          .where(and(inArray(t.id, systemLinked), eq(t.excludeReason, 'internal_transfer')));
      for (const p of pairs) {
        await tx.insert(schema.transactionLinks).values({
          kind: 'transfer',
          fromTxnId: p.fromTxnId,
          toTxnId: p.toTxnId,
          confidence: p.confidence.toFixed(2),
          createdBy: 'system',
        });
        await tx
          .update(t)
          .set({ excludeReason: 'internal_transfer' })
          .where(inArray(t.id, [p.fromTxnId, p.toTxnId]));
      }
      transfers = pairs.length;
    }

    // --- refunds ----------------------------------------------------------------------------------
    let refunds = 0;
    if (cardIds.length) {
      const existing = await tx
        .select({
          refundTxnId: schema.transactionLinks.fromTxnId,
          purchaseTxnId: schema.transactionLinks.toTxnId,
        })
        .from(schema.transactionLinks)
        .where(eq(schema.transactionLinks.kind, 'refund'));
      const linkedRefunds = new Set(existing.map((e) => e.refundTxnId));
      const refundedSoFar = new Map<string, number>();
      const refundRows = await tx
        .select({
          id: t.id,
          accountId: t.accountId,
          txnDate: t.txnDate,
          chargedAmountAgorot: t.chargedAmountAgorot,
          merchantNormalized: t.merchantNormalized,
        })
        .from(t)
        .where(and(inArray(t.accountId, cardIds), sql`${t.chargedAmountAgorot} > 0`));
      for (const e of existing) {
        const r = refundRows.find((x) => x.id === e.refundTxnId);
        if (r)
          refundedSoFar.set(
            e.purchaseTxnId,
            (refundedSoFar.get(e.purchaseTxnId) ?? 0) + r.chargedAmountAgorot,
          );
      }
      const purchases = await tx
        .select({
          id: t.id,
          accountId: t.accountId,
          txnDate: t.txnDate,
          chargedAmountAgorot: t.chargedAmountAgorot,
          merchantNormalized: t.merchantNormalized,
          categoryId: t.categoryId,
        })
        .from(t)
        .where(and(inArray(t.accountId, cardIds), lt(t.chargedAmountAgorot, 0)));
      const matches = matchRefunds(
        refundRows.filter((r) => !linkedRefunds.has(r.id)),
        purchases.map((p) => ({
          ...p,
          categoryId: p.categoryId ?? undefined,
          refundedSoFarAgorot: refundedSoFar.get(p.id) ?? 0,
        })),
      );
      for (const m of matches) {
        await tx
          .insert(schema.transactionLinks)
          .values({
            kind: 'refund',
            fromTxnId: m.refundTxnId,
            toTxnId: m.purchaseTxnId,
            createdBy: 'system',
          })
          .onConflictDoNothing();
        if (m.categoryId) {
          await tx
            .update(t)
            .set({ categoryId: m.categoryId, categorySource: 'refund_link', categoryRuleId: null })
            .where(
              and(
                eq(t.id, m.refundTxnId),
                or(isNull(t.categorySource), ne(t.categorySource, 'manual')),
              ),
            );
        }
      }
      refunds = matches.length;
    }
    return { settlements, transfers, refunds };
  });
}
