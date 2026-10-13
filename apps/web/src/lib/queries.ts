import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  AccountDto,
  AuthStatus,
  CategoryDto,
  MonthReportDto,
  RuleDto,
  SourceDto,
  TransactionDto,
  createFileSourceBody,
  createRuleBody,
  updateAccountBody,
  updateRuleBody,
  updateTransactionBody,
} from '@pinkas/shared';
import type { z } from 'zod';
import { api, qs } from './api';

export type CreateFileSourceBody = z.infer<typeof createFileSourceBody>;
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
