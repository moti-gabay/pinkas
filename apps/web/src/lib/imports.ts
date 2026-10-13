import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './api';
import { keys } from './queries';

export interface ColumnMapping {
  headerRowIndex: number;
  date: string;
  processedDate?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  description: string;
  memo?: string;
  identifier?: string;
  originalAmount?: string;
  originalCurrency?: string;
  balance?: string;
  amountSign: 'natural' | 'invert';
  dateFormat: 'auto' | 'DMY' | 'MDY' | 'YMD';
}

export type RowDecision = 'insert' | 'duplicate' | 'update_pending' | 'update_status' | 'error';

export interface ParsedPreview {
  rows: {
    rowIndex: number;
    txnDate: string;
    chargedAmountAgorot: number;
    descriptionRaw: string;
    status: string;
    decision: RowDecision;
    error?: string;
  }[];
  errors: { rowIndex: number; message: string }[];
  counts: { insert: number; duplicate: number; update: number; error: number };
  computedTotalAgorot: number;
  statementTotalAgorot: number | null;
  reconciled: boolean | null;
  hashKindDowngrade: boolean;
}

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

export interface ImportSummary {
  id: string;
  fileName: string;
  status: string;
  rowsAdded: number;
  rowsSkipped: number;
  reconciled: boolean | null;
  createdAt: string;
  committedAt: string | null;
  accountId: string;
}

export interface ConfirmResult {
  rowsAdded: number;
  rowsUpdated: number;
  rowsSkipped: number;
  reconciled: boolean | null;
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const useImports = () =>
  useQuery({ queryKey: keys.imports, queryFn: () => api<ImportSummary[]>('/imports') });

export const useImportPreview = (id: string | undefined, tableIndex: number | undefined) =>
  useQuery({
    queryKey: keys.importPreview(id ?? '', tableIndex),
    queryFn: () => api<ImportPreview>(`/imports/${id}/preview${qs({ tableIndex })}`),
    enabled: id !== undefined,
    retry: false,
  });

export function useUploadImport() {
  return useMutation({
    mutationFn: ({ file, accountId }: { file: File; accountId: string }) => {
      const body = new FormData();
      body.append('accountId', accountId);
      body.append('file', file);
      return api<{ importId: string }>('/imports', { method: 'POST', body });
    },
  });
}

/** `viewTableIndex` is the preview query the page is showing, so the PUT result lands in its cache entry. */
export function useUpdateMapping(id: string, viewTableIndex: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mapping: ColumnMapping; tableIndex: number }) =>
      api<ImportPreview>(`/imports/${id}/mapping`, { method: 'PUT', json: body }),
    onSuccess: (preview) => {
      qc.setQueryData(keys.importPreview(id, viewTableIndex), preview);
    },
  });
}

export function useConfirmImport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (acknowledgeMismatch: boolean) =>
      api<ConfirmResult>(`/imports/${id}/confirm`, {
        method: 'POST',
        json: { acknowledgeMismatch },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.imports });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
      void qc.invalidateQueries({ queryKey: keys.accounts });
    },
  });
}

export function useCancelImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/imports/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.imports }),
  });
}
