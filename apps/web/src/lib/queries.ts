import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  AccountDto,
  AuthStatus,
  CategoryDto,
  MonthReportDto,
  RuleDto,
  SourceDto,
  SyncRunDto,
  TransactionDto,
  createFileSourceBody,
  createRuleBody,
  createScraperSourceBody,
  updateAccountBody,
  updateRuleBody,
  updateTransactionBody,
} from '@pinkas/shared';
import type { z } from 'zod';
import { api, qs } from './api';
import type { ReconciliationDto } from './reconciliation';
import { isRunActive } from './sync';

export type CreateFileSourceBody = z.infer<typeof createFileSourceBody>;
export type CreateScraperSourceBody = z.infer<typeof createScraperSourceBody>;
export interface UpdateSourceBody {
  displayName?: string;
  enabled?: boolean;
  scheduleCron?: string | null;
}
export interface SyncRunsParams {
  sourceId?: string | undefined;
  limit?: number | undefined;
}
export type CreateRuleBody = z.input<typeof createRuleBody>;
export type UpdateRuleBody = z.input<typeof updateRuleBody>;
export type UpdateAccountBody = z.infer<typeof updateAccountBody>;
export type UpdateTransactionBody = z.infer<typeof updateTransactionBody>;

export interface TransactionsParams {
  from?: string | undefined;
  to?: string | undefined;
  accountId?: string | undefined;
  categoryId?: string | undefined;
  q?: string | undefined;
  uncategorized?: boolean | undefined;
  includeExcluded?: boolean | undefined;
  tag?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | undefined;
}

export interface ProposedRule {
  pattern: string;
  match: RuleDto['match'];
  field: RuleDto['field'];
  categoryId: string;
  alreadyExists: boolean;
}

export const keys = {
  auth: ['auth'] as const,
  sources: ['sources'] as const,
  accounts: ['accounts'] as const,
  categories: ['categories'] as const,
  rules: ['rules'] as const,
  transactions: (p: TransactionsParams) => ['transactions', p] as const,
  report: (month: string) => ['report', month] as const,
  imports: ['imports'] as const,
  syncRuns: (p: SyncRunsParams) => ['sync-runs', p] as const,
  reconciliation: ['reconciliation'] as const,
  importPreview: (id: string, tableIndex: number | undefined) =>
    ['imports', id, tableIndex] as const,
};

// auth
export const useAuthStatus = () =>
  useQuery({ queryKey: keys.auth, queryFn: () => api<AuthStatus>('/auth/status'), retry: false });

function useAuthMutation(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      api<{ ok: true }>(path, { method: 'POST', json: { password } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.auth }),
  });
}
export const useLogin = () => useAuthMutation('/auth/login');
export const useSetup = () => useAuthMutation('/auth/setup');
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData<AuthStatus>(keys.auth, { authenticated: false, setupRequired: false });
    },
  });
}

// sources & accounts
export const useSources = () =>
  useQuery({ queryKey: keys.sources, queryFn: () => api<SourceDto[]>('/sources') });
export const useAccounts = () =>
  useQuery({ queryKey: keys.accounts, queryFn: () => api<AccountDto[]>('/accounts') });

export function useCreateFileSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFileSourceBody) =>
      api<{ source: SourceDto; account: AccountDto }>('/sources/file', {
        method: 'POST',
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: keys.accounts });
    },
  });
}
export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/sources/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: keys.accounts });
    },
  });
}

// scraper sources & sync
// Credentials pass through these two mutations: gcTime 0 so they are not kept in the mutation cache.
export function useCreateScraperSource() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: CreateScraperSourceBody) =>
      api<SourceDto>('/sources/scraper', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sources }),
  });
}
export function useUpdateCredentials() {
  const qc = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: ({ id, credentials }: { id: string; credentials: Record<string, string> }) =>
      api<SourceDto>(`/sources/${id}/credentials`, { method: 'PUT', json: { credentials } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sources }),
  });
}
export function useUpdateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateSourceBody & { id: string }) =>
      api<SourceDto>(`/sources/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sources }),
  });
}

/** Latest run of one source; polls every 3s while that run is queued/running. */
export const latestRunParams = (sourceId: string): SyncRunsParams => ({ sourceId, limit: 1 });
export const useLatestSyncRun = (sourceId: string) =>
  useQuery({
    queryKey: keys.syncRuns(latestRunParams(sourceId)),
    queryFn: () => api<SyncRunDto[]>(`/sync-runs${qs(latestRunParams(sourceId))}`),
    refetchInterval: (q) => (isRunActive(q.state.data?.[0]) ? 3000 : false),
  });
export const useSyncRuns = (p: SyncRunsParams) =>
  useQuery({
    queryKey: keys.syncRuns(p),
    queryFn: () => api<SyncRunDto[]>(`/sync-runs${qs(p)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      api<SyncRunDto>(`/sources/${sourceId}/sync`, { method: 'POST' }),
    // Seed the latest-run query with the queued run so polling starts immediately.
    onSuccess: (run) => {
      qc.setQueryData<SyncRunDto[]>(keys.syncRuns(latestRunParams(run.sourceId)), [run]);
    },
  });
}

// reconciliation
export const useReconciliation = () =>
  useQuery({
    queryKey: keys.reconciliation,
    queryFn: () => api<ReconciliationDto>('/reconciliation'),
  });
function useTransferLinkMutation(method: 'POST' | 'DELETE') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      api<{ ok: true }>(
        `/reconciliation/transfers/${linkId}${method === 'POST' ? '/confirm' : ''}`,
        { method },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.reconciliation });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}
export const useConfirmTransfer = () => useTransferLinkMutation('POST');
export const useUnlinkTransfer = () => useTransferLinkMutation('DELETE');

// categories & rules
export const useCategories = () =>
  useQuery({
    queryKey: keys.categories,
    queryFn: () => api<CategoryDto[]>('/categories'),
    staleTime: 5 * 60_000,
  });
export const useRules = () =>
  useQuery({ queryKey: keys.rules, queryFn: () => api<RuleDto[]>('/rules') });

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRuleBody) =>
      api<{ rule: RuleDto; recategorized: number }>('/rules', { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.rules });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}
export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateRuleBody & { id: string }) =>
      api<RuleDto>(`/rules/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rules }),
  });
}
export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rules }),
  });
}
export function useReapplyRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ recategorized: number }>('/rules/reapply', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.rules });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

// transactions
export const useTransactions = (p: TransactionsParams) =>
  useQuery({
    queryKey: keys.transactions(p),
    queryFn: () => api<{ items: TransactionDto[]; total: number }>(`/transactions${qs(p)}`),
    placeholderData: keepPreviousData,
  });

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateTransactionBody & { id: string }) =>
      api<{ transaction: TransactionDto; proposedRule: ProposedRule | null }>(
        `/transactions/${id}`,
        { method: 'PATCH', json: body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
    },
  });
}

// reports
export const useMonthReport = (month: string) =>
  useQuery({
    queryKey: keys.report(month),
    queryFn: () => api<MonthReportDto>(`/reports/month/${month}`),
    placeholderData: keepPreviousData,
  });
