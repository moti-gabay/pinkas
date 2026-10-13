import { PinkasError, uuid } from '@pinkas/shared';
import { schema } from '@pinkas/db';
import { desc } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ColumnMapping } from '@pinkas/file-parsers';
import type { ImportService } from '../import/service.js';

/** zod yields `key?: string | undefined`; ColumnMapping (exactOptionalPropertyTypes) wants absent keys instead. */
function toMapping(m: z.infer<typeof columnMapping>): ColumnMapping {
  return Object.fromEntries(
    Object.entries(m).filter(([, v]) => v !== undefined),
  ) as unknown as ColumnMapping;
}

const columnMapping = z.object({
  headerRowIndex: z.number().int().min(0),
  date: z.string(),
  processedDate: z.string().optional(),
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  description: z.string(),
  memo: z.string().optional(),
  identifier: z.string().optional(),
  originalAmount: z.string().optional(),
  originalCurrency: z.string().optional(),
  balance: z.string().optional(),
  amountSign: z.enum(['natural', 'invert']),
  dateFormat: z.enum(['auto', 'DMY', 'MDY', 'YMD']),
});

export function importRoutes(service: ImportService): FastifyPluginAsyncZod {
  return async (app) => {
    app.post('/imports', async (req) => {
      const part = await req.file();
      if (!part) throw new PinkasError('VALIDATION', 'file field missing');
      const accountId = (part.fields['accountId'] as { value?: unknown } | undefined)?.value;
      const parsedAccount = uuid.safeParse(accountId);
      if (!parsedAccount.success) throw new PinkasError('VALIDATION', 'accountId missing');
      const bytes = await part.toBuffer();
      if (part.file.truncated) throw new PinkasError('UPLOAD_TOO_LARGE', 'upload truncated');
      const importId = await service.upload({
        fileName: part.filename,
        mime: part.mimetype,
        bytes,
        accountId: parsedAccount.data,
      });
      return { importId };
    });

    app.get('/imports', async () => {
      const rows = await app.db
        .select()
        .from(schema.imports)
        .orderBy(desc(schema.imports.createdAt))
        .limit(100);
      return rows.map((r) => ({
        id: r.id,
        fileName: r.fileName,
        status: r.status,
        rowsAdded: r.rowsAdded,
        rowsSkipped: r.rowsSkipped,
        reconciled: r.reconciled,
        createdAt: r.createdAt.toISOString(),
        committedAt: r.committedAt?.toISOString() ?? null,
        accountId: r.accountId,
      }));
    });

    app.get(
      '/imports/:id/preview',
      {
        schema: {
          params: z.object({ id: uuid }),
          querystring: z.object({ tableIndex: z.coerce.number().int().min(0).optional() }),
        },
      },
      async (req) => {
        return service.preview(
          req.params.id,
          req.query.tableIndex === undefined ? {} : { tableIndex: req.query.tableIndex },
        );
      },
    );

    app.put(
      '/imports/:id/mapping',
      {
        schema: {
          params: z.object({ id: uuid }),
          body: z.object({
            mapping: columnMapping,
            tableIndex: z.number().int().min(0).optional(),
          }),
        },
      },
      async (req) => {
        return service.preview(req.params.id, {
          mapping: toMapping(req.body.mapping),
          ...(req.body.tableIndex === undefined ? {} : { tableIndex: req.body.tableIndex }),
        });
      },
    );

    app.post(
      '/imports/:id/confirm',
      {
        schema: {
          params: z.object({ id: uuid }),
          body: z
            .object({ acknowledgeMismatch: z.boolean().default(false) })
            .default({ acknowledgeMismatch: false }),
        },
      },
      async (req) => {
        return service.confirm(req.params.id, req.body);
      },
    );

    app.post('/imports/:id/cancel', { schema: { params: z.object({ id: uuid }) } }, async (req) => {
      await service.cancel(req.params.id);
      return { ok: true };
    });
  };
}
