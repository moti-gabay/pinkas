/**
 * Ingestion: the single path by which rows from any source (scraper, file, manual) enter the ledger.
 *  1. decide hash kind from `sources.hash_kind` (sticky; downgrade + recompute in the same transaction)
 *  2. hash the batch, look up existing rows by hash
 *  3. exact hit → no-op (or pending→completed update when the identifier hash carried over)
 *  4. no hit, completed → try to match an existing pending row and update it in place
 *  5. otherwise insert, categorized by rules
 * `dryRun` returns the plan without writing (import preview).
 */
import { createHash } from 'node:crypto';
import { schema, type Db } from '@pinkas/db';
import {
  applyRules,
  descriptionKey,
  findPendingMatch,
  hashBatch,
  identifiersCollide,
  installmentGroupKey,
  normalizeMerchant,
  sortRules,
  usableIdentifier,
  type CategoryRule,
  type HashKind,
  type NormalizedTxn,
  type StoredTxn,
} from '@pinkas/domain';
import { UNCATEGORIZED_SLUG } from '@pinkas/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type RowDecision = 'insert' | 'duplicate' | 'update_pending' | 'update_status';

export interface IngestInput {
  sourceId: string;
  rows: NormalizedTxn[];
  importId?: string;
  dryRun?: boolean;
}

export interface IngestResult {
  decisions: RowDecision[];
  hashes: string[];
  rowsAdded: number;
  rowsUpdated: number;
  rowsDuplicate: number;
  hashKind: HashKind;
  downgraded: boolean;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const ruleCols = {
  id: schema.categoryRules.id,
  pattern: schema.categoryRules.pattern,
  match: schema.categoryRules.match,
  field: schema.categoryRules.field,
  categoryId: schema.categoryRules.categoryId,
  isFixed: schema.categoryRules.isFixed,
  priority: schema.categoryRules.priority,
  accountScope: schema.categoryRules.accountScope,
  enabled: schema.categoryRules.enabled,
};

export async function loadSortedRules(db: Db | Tx): Promise<CategoryRule[]> {
  const rows = await db
    .select(ruleCols)
    .from(schema.categoryRules)
    .where(eq(schema.categoryRules.enabled, true));
  return sortRules(
    rows.map((r) => ({
      ...r,
      isFixed: r.isFixed ?? undefined,
      accountScope: r.accountScope ?? undefined,
    })),
  );
}

export async function uncategorizedId(db: Db | Tx): Promise<string> {
  const row = await db.query.categories.findFirst({
    where: eq(schema.categories.slug, UNCATEGORIZED_SLUG),
  });
  if (!row) throw new Error('taxonomy not seeded');
  return row.id;
}

export async function ingest(db: Db, input: IngestInput): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const source = await tx.query.sources.findFirst({
      where: eq(schema.sources.id, input.sourceId),
    });
    if (!source) throw new Error(`unknown source ${input.sourceId}`);
    const accountIds = [...new Set(input.rows.map((r) => r.accountId))];
    let hashKind = source.hashKind;
    let downgraded = false;

    if (hashKind === 'identifier') {
      const batchIds = input.rows
        .map((r) => usableIdentifier(r.externalIdentifier))
        .filter((x): x is string => x !== undefined);
      const existing = batchIds.length
        ? await tx
            .select({
              accountId: schema.transactions.accountId,
              externalIdentifier: schema.transactions.externalIdentifier,
              txnDate: schema.transactions.txnDate,
              chargedAmountAgorot: schema.transactions.chargedAmountAgorot,
              status: schema.transactions.status,
            })
            .from(schema.transactions)
            .where(
              and(
                inArray(schema.transactions.accountId, accountIds),
                inArray(schema.transactions.externalIdentifier, batchIds),
              ),
            )
        : [];
      // Existing pending rows legitimately change amount/date when they post, so they are not collision evidence.
      const probe = [
        ...existing
          .filter((e) => e.status !== 'pending')
          .map((e) => ({ ...e, externalIdentifier: e.externalIdentifier ?? undefined })),
        ...input.rows,
      ];
      if (identifiersCollide(probe)) {
        await downgradeSource(tx, source.id, input.dryRun ?? false);
        hashKind = 'fields';
        downgraded = true;
      }
    }

    const hashed = hashBatch(input.rows, hashKind, sha256);
    const existingByHash = new Map<string, typeof schema.transactions.$inferSelect>();
    for (const chunk of chunks(
      hashed.map((h) => h.dedupeHash),
      500,
    )) {
      const rows = await tx
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.hashVersion, 1),
            inArray(schema.transactions.dedupeHash, chunk),
          ),
        );
      for (const r of rows) existingByHash.set(r.dedupeHash, r);
    }
    const pendingRows = await tx
      .select()
      .from(schema.transactions)
      .where(
        and(
          inArray(schema.transactions.accountId, accountIds),
          eq(schema.transactions.status, 'pending'),
        ),
      );
    const pendingCandidates: StoredTxn[] = pendingRows.map(toStored);
    const consumedPending = new Set<string>();
    const rules = await loadSortedRules(tx);
    const defaultCategory = await uncategorizedId(tx);

    const decisions: RowDecision[] = [];
    const hashes: string[] = [];
    let rowsAdded = 0;
    let rowsUpdated = 0;
    let rowsDuplicate = 0;
    const seenInBatch = new Set<string>();

    for (const row of hashed) {
      hashes.push(row.dedupeHash);
      const merchantNormalized = normalizeMerchant(row.descriptionRaw);
      const full = {
        ...row,
        merchantNormalized,
        installmentGroupKey: installmentGroupKey(row, merchantNormalized),
      };
      if (seenInBatch.has(row.dedupeHash)) {
        decisions.push('duplicate');
        rowsDuplicate++;
        continue;
      }
      seenInBatch.add(row.dedupeHash);
      const hit = existingByHash.get(row.dedupeHash);
      if (hit) {
        if (hit.status === 'pending' && row.status === 'completed') {
          decisions.push('update_status');
          rowsUpdated++;
          if (!input.dryRun)
            await tx
              .update(schema.transactions)
              .set({
                status: 'completed',
                chargedAmountAgorot: row.chargedAmountAgorot,
                txnDate: row.txnDate,
                processedDate: row.processedDate ?? null,
                stalePending: false,
              })
              .where(eq(schema.transactions.id, hit.id));
        } else {
          decisions.push('duplicate');
          rowsDuplicate++;
        }
        continue;
      }
      const pending = findPendingMatch(
        full,
        pendingCandidates.filter((p) => !consumedPending.has(p.id)),
      );
      if (pending) {
        consumedPending.add(pending.id);
        decisions.push('update_pending');
        rowsUpdated++;
        if (!input.dryRun) {
          await tx
            .update(schema.transactions)
            .set({
              status: 'completed',
              chargedAmountAgorot: row.chargedAmountAgorot,
              txnDate: row.txnDate,
              processedDate: row.processedDate ?? null,
              stalePending: false,
              dedupeHash: row.dedupeHash,
              hashKind: row.hashKind,
              externalIdentifier: row.externalIdentifier ?? null,
              descriptionRaw: row.descriptionRaw,
              merchantNormalized,
              previousHashes: sql`array_append(${schema.transactions.previousHashes}, ${pending.dedupeHash})`,
            })
            .where(eq(schema.transactions.id, pending.id));
        }
        continue;
      }
      decisions.push('insert');
      rowsAdded++;
      if (!input.dryRun) {
        const hit2 = applyRules(rules, {
          accountId: row.accountId,
          merchantNormalized,
          descriptionRaw: row.descriptionRaw,
        });
        await tx.insert(schema.transactions).values({
          accountId: row.accountId,
          dedupeHash: row.dedupeHash,
          hashVersion: row.hashVersion,
          hashKind: row.hashKind,
          origin: row.origin,
          importId: input.importId ?? null,
          externalIdentifier: row.externalIdentifier ?? null,
          txnDate: row.txnDate,
          processedDate: row.processedDate ?? null,
          chargedAmountAgorot: row.chargedAmountAgorot,
          originalAmountMinor: row.originalAmountMinor ?? null,
          originalCurrency: row.originalCurrency ?? null,
          status: row.status,
          descriptionRaw: row.descriptionRaw,
          merchantNormalized,
          memo: row.memo ?? null,
          installmentNumber: row.installmentNumber ?? null,
          installmentTotal: row.installmentTotal ?? null,
          installmentGroupKey: full.installmentGroupKey ?? null,
          categoryId: hit2?.categoryId ?? defaultCategory,
          categorySource: hit2 ? 'rule' : 'default',
          categoryRuleId: hit2?.rule.id ?? null,
          isFixed: hit2?.isFixed ?? null,
        });
        if (hit2)
          await tx
            .update(schema.categoryRules)
            .set({ hitCount: sql`${schema.categoryRules.hitCount} + 1` })
            .where(eq(schema.categoryRules.id, hit2.rule.id));
      }
    }
    // A dry run performs no writes (every write above is guarded), so the transaction commits empty.
    return { decisions, hashes, rowsAdded, rowsUpdated, rowsDuplicate, hashKind, downgraded };
  });
}

/** Sticky downgrade: flip the source to field hashing and recompute every identifier-hashed row it owns. */
async function downgradeSource(tx: Tx, sourceId: string, dryRun: boolean): Promise<void> {
  if (dryRun) return; // the preview only reports `downgraded`; the commit performs it
  await tx
    .update(schema.sources)
    .set({ hashKind: 'fields' })
    .where(eq(schema.sources.id, sourceId));
  const accounts = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.sourceId, sourceId));
  const ids = accounts.map((a) => a.id);
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.accountId,
      txnDate: schema.transactions.txnDate,
      chargedAmountAgorot: schema.transactions.chargedAmountAgorot,
      descriptionRaw: schema.transactions.descriptionRaw,
      dedupeHash: schema.transactions.dedupeHash,
    })
    .from(schema.transactions)
    .where(
      and(
        inArray(schema.transactions.accountId, ids),
        eq(schema.transactions.hashKind, 'identifier'),
      ),
    )
    .orderBy(schema.transactions.createdAt, schema.transactions.id);
  const ordinals = new Map<string, number>();
  for (const r of rows) {
    const group = [
      r.accountId,
      r.txnDate,
      String(r.chargedAmountAgorot),
      descriptionKey(r.descriptionRaw),
    ].join('|');
    const ordinal = ordinals.get(group) ?? 0;
    ordinals.set(group, ordinal + 1);
    const newHash = sha256(['v1', 'f', group, String(ordinal)].join('|'));
    await tx
      .update(schema.transactions)
      .set({
        dedupeHash: newHash,
        hashKind: 'fields',
        previousHashes: sql`array_append(${schema.transactions.previousHashes}, ${r.dedupeHash})`,
      })
      .where(eq(schema.transactions.id, r.id));
  }
}

function toStored(r: typeof schema.transactions.$inferSelect): StoredTxn {
  return {
    id: r.id,
    accountId: r.accountId,
    dedupeHash: r.dedupeHash,
    hashKind: r.hashKind,
    externalIdentifier: r.externalIdentifier ?? undefined,
    txnDate: r.txnDate,
    processedDate: r.processedDate ?? undefined,
    chargedAmountAgorot: r.chargedAmountAgorot,
    status: r.status,
    descriptionRaw: r.descriptionRaw,
    merchantNormalized: r.merchantNormalized,
    categoryId: r.categoryId ?? undefined,
    categorySource: r.categorySource ?? undefined,
    isFixed: r.isFixed ?? undefined,
    excludeReason: r.excludeReason ?? undefined,
    installmentNumber: r.installmentNumber ?? undefined,
    installmentTotal: r.installmentTotal ?? undefined,
  };
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
