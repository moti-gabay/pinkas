/**
 * Import pipeline: upload → sniff + parse → preview with mapping → confirm → ingest → delete file.
 * The uploaded bytes are stored under a random name in UPLOAD_DIR and deleted on commit/cancel/expiry.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedTxn } from '@pinkas/domain';
import {
  loadFile,
  parseTable,
  pickAdapter,
  type ColumnMapping,
  type LoadedFile,
  type ParseResult,
} from '@pinkas/file-parsers';
import { PinkasError } from '@pinkas/shared';
import { and, eq } from 'drizzle-orm';
import { ingest, schema, type Db, type IngestResult, type RowDecision } from '@pinkas/db';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export interface ImportPreview {
  importId: string;
  status: string;
  tables: { index: number; name: string; rowCount: number }[];
  tableIndex: number;
  headerRowIndex: number;
  headers: string[];
  mapping: ColumnMapping | null;
  sampleRows: { rowIndex: number; cells: (string | number | null)[] }[];
  parsed: ParsedPreview | null;
}

export interface ParsedPreview {
  rows: {
    rowIndex: number;
    txnDate: string;
    chargedAmountAgorot: number;
    descriptionRaw: string;
    status: string;
    decision: RowDecision | 'error';
    error: string | undefined;
  }[];
  errors: { rowIndex: number; message: string }[];
  counts: { insert: number; duplicate: number; update: number; error: number };
  computedTotalAgorot: number;
  statementTotalAgorot: number | null;
  reconciled: boolean | null;
  hashKindDowngrade: boolean;
}

/** A statement's total row may be printed as a debit, a credit or a signed number; only the magnitude is comparable. */
function totalsReconcile(statementTotal: number, computedTotal: number): boolean {
  return Math.abs(statementTotal) === Math.abs(computedTotal);
}

export class ImportService {
  constructor(
    private readonly db: Db,
    private readonly uploadDir: string,
    private readonly maxBytes: number,
  ) {}

  private path(importId: string): string {
    return join(this.uploadDir, `${importId}.bin`);
  }

  async upload(input: {
    fileName: string;
    mime: string;
    bytes: Uint8Array;
    accountId: string;
  }): Promise<string> {
    if (input.bytes.byteLength > this.maxBytes)
      throw new PinkasError(
        'UPLOAD_TOO_LARGE',
        `upload of ${input.bytes.byteLength} bytes exceeds limit`,
      );
    const hash = sha256(input.bytes);
    const committed = await this.db.query.imports.findFirst({
      where: and(eq(schema.imports.fileSha256, hash), eq(schema.imports.status, 'committed')),
    });
    if (committed)
      throw new PinkasError('IMPORT_DUPLICATE_FILE', 'file already imported', {
        details: { importId: committed.id },
      });
    const account = await this.db.query.accounts.findFirst({
      where: eq(schema.accounts.id, input.accountId),
    });
    if (!account) throw new PinkasError('NOT_FOUND', 'account not found');
    let loaded: LoadedFile;
    try {
      loaded = await loadFile(input.bytes, { filename: input.fileName, mime: input.mime });
    } catch (err) {
      if (err instanceof PinkasError) throw err;
      throw new PinkasError('IMPORT_PARSE_FAILED', 'cannot load file', { cause: err });
    }
    const adapter = pickAdapter(loaded);
    const table = loaded.tables[0];
    const mapping = table ? adapter.defaultMapping(table) : undefined;
    const [row] = await this.db
      .insert(schema.imports)
      .values({
        fileName: input.fileName,
        fileSha256: hash,
        sizeBytes: input.bytes.byteLength,
        mime: loaded.format,
        parserId: adapter.id,
        accountId: input.accountId,
        status: 'parsed',
        columnMapping: mapping ?? null,
        tableIndex: 0,
      })
      .returning({ id: schema.imports.id });
    if (!row) throw new Error('insert failed');
    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(this.path(row.id), input.bytes, { mode: 0o600 });
    return row.id;
  }

  private async load(
    importId: string,
  ): Promise<{ record: typeof schema.imports.$inferSelect; file: LoadedFile }> {
    const record = await this.db.query.imports.findFirst({
      where: eq(schema.imports.id, importId),
    });
    if (!record) throw new PinkasError('NOT_FOUND', 'import not found');
    if (record.status === 'committed' || record.status === 'cancelled')
      throw new PinkasError('CONFLICT', `import is ${record.status}`);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(this.path(importId));
    } catch {
      throw new PinkasError('NOT_FOUND', 'uploaded file no longer available (expired)');
    }
    return { record, file: await loadFile(bytes, { filename: record.fileName }) };
  }

  async preview(
    importId: string,
    opts: { mapping?: ColumnMapping; tableIndex?: number } = {},
  ): Promise<ImportPreview> {
    const { record, file } = await this.load(importId);
    const tableIndex = opts.tableIndex ?? record.tableIndex;
    const table = file.tables[tableIndex];
    if (!table) throw new PinkasError('VALIDATION', 'no such table');
    const adapter = pickAdapter(file);
    const mapping =
      opts.mapping ??
      (record.columnMapping as ColumnMapping | null) ??
      adapter.defaultMapping(table) ??
      null;
    if (opts.mapping || opts.tableIndex !== undefined)
      await this.db
        .update(schema.imports)
        .set({ columnMapping: mapping, tableIndex })
        .where(eq(schema.imports.id, importId));
    const headerRowIndex = mapping?.headerRowIndex ?? 0;
    const headers = (table.rows[headerRowIndex] ?? []).map((c) => (c === null ? '' : String(c)));
    const sampleRows = table.rows
      .slice(0, headerRowIndex + 8)
      .map((cells, rowIndex) => ({ rowIndex, cells }));
    const base = {
      importId,
      status: record.status,
      tables: file.tables.map((tb, index) => ({ index, name: tb.name, rowCount: tb.rows.length })),
      tableIndex,
      headerRowIndex,
      headers,
      mapping,
      sampleRows,
    };
    if (!mapping || !record.accountId) return { ...base, parsed: null };
    const result = parseTable(table, mapping);
    const { preview } = await this.plan(record.accountId, result, true);
    return { ...base, parsed: preview };
  }

  private async plan(
    accountId: string,
    result: ParseResult,
    dryRun: boolean,
    importId?: string,
  ): Promise<{ preview: ParsedPreview; ingested: IngestResult }> {
    const account = await this.db.query.accounts.findFirst({
      where: eq(schema.accounts.id, accountId),
    });
    if (!account) throw new PinkasError('NOT_FOUND', 'account not found');
    const rows: NormalizedTxn[] = result.rows.map((r) => ({
      accountId,
      origin: 'import',
      externalIdentifier: r.externalIdentifier,
      txnDate: r.txnDate,
      processedDate: r.processedDate,
      chargedAmountAgorot: r.chargedAmountAgorot,
      originalAmountMinor: r.originalAmountMinor,
      originalCurrency: r.originalCurrency,
      status: r.status,
      descriptionRaw: r.descriptionRaw,
      memo: r.memo,
      installmentNumber: r.installmentNumber,
      installmentTotal: r.installmentTotal,
    }));
    const ingested = await ingest(this.db, {
      sourceId: account.sourceId,
      rows,
      dryRun,
      ...(importId ? { importId } : {}),
    });
    const computedTotalAgorot = result.rows.reduce((a, r) => a + r.chargedAmountAgorot, 0);
    const statementTotalAgorot = result.statementTotalAgorot ?? null;
    const reconciled =
      statementTotalAgorot === null
        ? null
        : totalsReconcile(statementTotalAgorot, computedTotalAgorot);
    const counts = {
      insert: ingested.rowsAdded,
      duplicate: ingested.rowsDuplicate,
      update: ingested.rowsUpdated,
      error: result.errors.length,
    };
    const errorByRow = new Map(result.errors.map((e) => [e.rowIndex, e.message]));
    const rowsOut: ParsedPreview['rows'] = [
      ...result.rows.map((r, i) => ({
        rowIndex: r.rowIndex,
        txnDate: r.txnDate,
        chargedAmountAgorot: r.chargedAmountAgorot,
        descriptionRaw: r.descriptionRaw,
        status: r.status,
        decision: ingested.decisions[i] ?? ('error' as const),
        error: undefined,
      })),
      ...result.errors.map((e) => ({
        rowIndex: e.rowIndex,
        txnDate: '',
        chargedAmountAgorot: 0,
        descriptionRaw: '',
        status: 'completed',
        decision: 'error' as const,
        error: errorByRow.get(e.rowIndex),
      })),
    ].sort((a, b) => a.rowIndex - b.rowIndex);
    return {
      preview: {
        rows: rowsOut,
        errors: result.errors,
        counts,
        computedTotalAgorot,
        statementTotalAgorot,
        reconciled,
        hashKindDowngrade: ingested.downgraded,
      },
      ingested,
    };
  }

  async confirm(
    importId: string,
    opts: { acknowledgeMismatch?: boolean } = {},
  ): Promise<{
    rowsAdded: number;
    rowsUpdated: number;
    rowsSkipped: number;
    reconciled: boolean | null;
  }> {
    const { record, file } = await this.load(importId);
    const mapping = record.columnMapping as ColumnMapping | null;
    if (!mapping || !record.accountId) throw new PinkasError('VALIDATION', 'mapping required');
    const table = file.tables[record.tableIndex];
    if (!table) throw new PinkasError('VALIDATION', 'no such table');
    const result = parseTable(table, mapping);
    const computedTotal = result.rows.reduce((a, r) => a + r.chargedAmountAgorot, 0);
    const reconciled =
      result.statementTotalAgorot === undefined
        ? null
        : totalsReconcile(result.statementTotalAgorot, computedTotal);
    if (reconciled === false && !opts.acknowledgeMismatch) {
      throw new PinkasError('IMPORT_NOT_RECONCILED', 'statement total mismatch', {
        details: {
          statementTotalAgorot: result.statementTotalAgorot,
          computedTotalAgorot: computedTotal,
        },
      });
    }
    const { ingested } = await this.plan(record.accountId, result, false, importId);
    const rowsSkipped = ingested.rowsDuplicate + result.errors.length;
    await this.db
      .update(schema.imports)
      .set({
        status: 'committed',
        committedAt: new Date(),
        rowsParsed: result.rows.length,
        rowsAdded: ingested.rowsAdded,
        rowsSkipped,
        statementTotalAgorot: result.statementTotalAgorot ?? null,
        computedTotalAgorot: computedTotal,
        reconciled,
        fileDeletedAt: new Date(),
      })
      .where(eq(schema.imports.id, importId));
    await rm(this.path(importId), { force: true });
    return {
      rowsAdded: ingested.rowsAdded,
      rowsUpdated: ingested.rowsUpdated,
      rowsSkipped,
      reconciled,
    };
  }

  async cancel(importId: string): Promise<void> {
    await this.db
      .update(schema.imports)
      .set({ status: 'cancelled', fileDeletedAt: new Date() })
      .where(eq(schema.imports.id, importId));
    await rm(this.path(importId), { force: true });
  }

  /** Deletes stale uploaded files (never committed) older than `maxAgeMs`. */
  async purgeExpired(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const stale = await this.db.query.imports.findMany({
      where: and(eq(schema.imports.status, 'parsed')),
    });
    let n = 0;
    for (const s of stale) {
      if (s.createdAt > cutoff) continue;
      await this.cancel(s.id);
      n++;
    }
    return n;
  }
}
