import { isoDate, type TransactionDto } from '@pinkas/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { CategorySelect } from '../components/CategorySelect';
import { ErrorNote } from '../components/ErrorNote';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { TransactionsTable } from '../components/TransactionsTable';
import { btn, input, label } from '../components/ui';
import { errorMessage } from '../lib/api';
import { currentMonth, monthRange } from '../lib/month';
import {
  useAccounts,
  useCategories,
  useCreateRule,
  useTransactions,
  useUpdateTransaction,
  type TransactionsParams,
} from '../lib/queries';

const PAGE = 100;

const searchSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  q: z.string().optional(),
  uncategorized: z.boolean().optional(),
  includeExcluded: z.boolean().optional(),
  page: z.number().int().min(0).optional(),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
});
type Search = z.infer<typeof searchSchema>;

export const Route = createFileRoute('/transactions')({
  validateSearch: searchSchema,
  component: TransactionsPage,
});

function TransactionsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const defaults = monthRange(currentMonth());
  const from = search.from ?? defaults.from;
  const to = search.to ?? defaults.to;
  const page = search.page ?? 0;
  const sort = search.sort ?? 'date_desc';

  const set = useCallback(
    (patch: Partial<Search>) =>
      void navigate({ to: '/transactions', search: { ...search, page: 0, ...patch } }),
    [navigate, search],
  );

  const params: TransactionsParams = {
    from,
    to,
    accountId: search.accountId,
    categoryId: search.categoryId,
    q: search.q,
    uncategorized: search.uncategorized,
    includeExcluded: search.includeExcluded,
    limit: PAGE,
    offset: page * PAGE,
    sort,
  };
  const txns = useTransactions(params);
  const accounts = useAccounts();
  const categories = useCategories();
  const update = useUpdateTransaction();
  const createRule = useCreateRule();
  const toast = useToast();
  const [q, setQ] = useState(search.q ?? '');

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.nameHe])),
    [categories.data],
  );

  const onCategoryChange = useCallback(
    (txn: TransactionDto, categoryId: string | null) => {
      update.mutate(
        { id: txn.id, categoryId },
        {
          onSuccess: ({ proposedRule }) => {
            if (!proposedRule || proposedRule.alreadyExists) return;
            toast({
              message: `לשמור כחוק? כל התנועות של «${proposedRule.pattern}» יסווגו כ-${categoryName.get(proposedRule.categoryId) ?? ''}`,
              action: {
                label: 'שמור כחוק',
                onClick: () => {
                  createRule.mutate(
                    {
                      pattern: proposedRule.pattern,
                      match: proposedRule.match,
                      field: proposedRule.field,
                      categoryId: proposedRule.categoryId,
                      origin: 'learned',
                      applyToExisting: true,
                    },
                    {
                      onSuccess: (r) => {
                        toast({ message: `החוק נשמר; סווגו מחדש ${r.recategorized} תנועות` });
                      },
                    },
                  );
                },
              },
            });
          },
          onError: (err) => {
            toast({ message: errorMessage(err), kind: 'error' });
          },
        },
      );
    },
    [update, createRule, toast, categoryName],
  );

  const total = txns.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">תנועות</h1>

      <form
        className="flex flex-wrap items-end gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: q.trim() || undefined });
        }}
      >
        <label className={label}>
          מתאריך
          <input
            className={`${input} num`}
            type="date"
            value={from}
            onChange={(e) => {
              set({ from: e.target.value });
            }}
          />
        </label>
        <label className={label}>
          עד תאריך
          <input
            className={`${input} num`}
            type="date"
            value={to}
            onChange={(e) => {
              set({ to: e.target.value });
            }}
          />
        </label>
        <label className={label}>
          חשבון
          <select
            className={input}
            value={search.accountId ?? ''}
            onChange={(e) => {
              set({ accountId: e.target.value || undefined });
            }}
          >
            <option value="">הכל</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName} {a.maskedLabel}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          קטגוריה
          <CategorySelect
            categories={categories.data ?? []}
            value={search.categoryId ?? null}
            placeholder="הכל"
            onChange={(id) => {
              set({ categoryId: id ?? undefined });
            }}
          />
        </label>
        <label className={label}>
          חיפוש
          <input
            className={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            onBlur={() => {
              set({ q: q.trim() || undefined });
            }}
            placeholder="טקסט חופשי"
          />
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={search.uncategorized ?? false}
            onChange={(e) => {
              set({ uncategorized: e.target.checked || undefined });
            }}
          />
          ללא קטגוריה
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={search.includeExcluded ?? false}
            onChange={(e) => {
              set({ includeExcluded: e.target.checked || undefined });
            }}
          />
          הצג מוחרגות
        </label>
      </form>

      <ErrorNote error={txns.error ?? update.error ?? createRule.error} />
      {txns.isPending && <Spinner />}
      {!txns.isPending && (
        <TransactionsTable
          items={txns.data?.items}
          accounts={accounts.data ?? []}
          categories={categories.data ?? []}
          sort={sort}
          onSort={(s) => {
            set({ sort: s });
          }}
          onCategoryChange={onCategoryChange}
          busy={update.isPending}
        />
      )}

      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          className={btn}
          disabled={page === 0}
          onClick={() => {
            set({ page: page - 1 });
          }}
        >
          הקודם
        </button>
        <span className="num">
          {total === 0 ? 0 : page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} / {total}
        </span>
        <button
          type="button"
          className={btn}
          disabled={page >= lastPage}
          onClick={() => {
            set({ page: page + 1 });
          }}
        >
          הבא
        </button>
      </div>
    </div>
  );
}
