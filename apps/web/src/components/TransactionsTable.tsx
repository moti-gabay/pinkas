import { formatDate, type AccountDto, type CategoryDto, type TransactionDto } from '@pinkas/shared';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import type { TransactionsParams } from '../lib/queries';
import { CategorySelect } from './CategorySelect';
import { MoneyAmount } from './MoneyAmount';
import { TransactionPanel } from './TransactionPanel';
import { badge, td, th } from './ui';

type Sort = NonNullable<TransactionsParams['sort']>;
const features = tableFeatures({});
const helper = createColumnHelper<typeof features, TransactionDto>();
const emptyRows: TransactionDto[] = [];

export function TransactionsTable({
  items,
  accounts,
  categories,
  sort,
  onSort,
  onCategoryChange,
  busy,
}: {
  items: TransactionDto[] | undefined;
  accounts: AccountDto[];
  categories: CategoryDto[];
  sort: Sort;
  onSort: (s: Sort) => void;
  onCategoryChange: (txn: TransactionDto, categoryId: string | null) => void;
  busy: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const accountLabel = useMemo(
    () => new Map(accounts.map((a) => [a.id, `${a.displayName} ${a.maskedLabel}`])),
    [accounts],
  );

  const sortHeader = (label: string, desc: Sort, asc: Sort) => (
    <button
      type="button"
      className="font-medium hover:underline"
      onClick={() => {
        onSort(sort === desc ? asc : desc);
      }}
    >
      {label} {sort === desc ? '▼' : sort === asc ? '▲' : ''}
    </button>
  );

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('txnDate', {
          header: () => sortHeader('תאריך', 'date_desc', 'date_asc'),
          cell: (info) => (
            <span className="num whitespace-nowrap">{formatDate(info.getValue())}</span>
          ),
        }),
        helper.display({
          id: 'description',
          header: 'תיאור',
          cell: ({ row }) => {
            const t = row.original;
            return (
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-medium">{t.merchantNormalized || t.descriptionRaw}</span>
                {t.merchantNormalized && t.merchantNormalized !== t.descriptionRaw && (
                  <span className="text-xs text-gray-500">{t.descriptionRaw}</span>
                )}
                {t.installmentNumber !== null && t.installmentTotal !== null && (
                  <span className={`${badge} num bg-gray-100 dark:bg-gray-800`}>
                    {t.installmentNumber}/{t.installmentTotal}
                  </span>
                )}
                {t.status === 'pending' && (
                  <span
                    className={`${badge} ${t.stalePending ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}
                  >
                    {t.stalePending ? 'ממתין (תקוע)' : 'ממתין'}
                  </span>
                )}
                {t.excludeReason !== null && (
                  <span className={`${badge} bg-gray-200 dark:bg-gray-700`}>מוחרג</span>
                )}
              </div>
            );
          },
        }),
        helper.accessor('accountId', {
          header: 'חשבון',
          cell: (info) => (
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {accountLabel.get(info.getValue()) ?? '?'}
            </span>
          ),
        }),
        helper.accessor('chargedAmountAgorot', {
          header: () => sortHeader('סכום', 'amount_desc', 'amount_asc'),
          cell: (info) => <MoneyAmount agorot={info.getValue()} className="whitespace-nowrap" />,
        }),
        helper.accessor('categoryId', {
          header: 'קטגוריה',
          cell: (info) => (
            <CategorySelect
              categories={categories}
              value={info.getValue()}
              disabled={busy}
              onChange={(id) => {
                onCategoryChange(info.row.original, id);
              }}
            />
          ),
        }),
        helper.accessor('tags', {
          header: 'תגיות',
          cell: (info) => (
            <div className="flex flex-wrap gap-1">
              {info.getValue().map((tag) => (
                <span
                  key={tag}
                  className={`${badge} bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300`}
                >
                  {tag}
                </span>
              ))}
            </div>
          ),
        }),
        helper.display({
          id: 'expand',
          header: '',
          cell: ({ row }) => (
            <button
              type="button"
              aria-label="פרטים"
              className="px-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
              onClick={() => {
                setExpandedId((cur) => (cur === row.original.id ? null : row.original.id));
              }}
            >
              {expandedId === row.original.id ? '▲' : '▼'}
            </button>
          ),
        }),
      ]),
    [accountLabel, categories, busy, onCategoryChange, sort, onSort, expandedId],
  );

  const table = useTable({
    features,
    columns,
    data: items ?? emptyRows,
    getRowId: (r) => r.id,
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id} className={th}>
                  {h.isPlaceholder ? null : <table.FlexRender header={h} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <RowGroup key={row.id} expanded={expandedId === row.original.id} txn={row.original}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={td}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </RowGroup>
          ))}
        </tbody>
      </table>
      {items?.length === 0 && <p className="p-4 text-center text-gray-500">לא נמצאו תנועות</p>}
    </div>
  );
}

function RowGroup({
  txn,
  expanded,
  children,
}: {
  txn: TransactionDto;
  expanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr
        className={`border-t border-gray-100 dark:border-gray-800 ${txn.excludeReason !== null ? 'opacity-60' : ''}`}
      >
        {children}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <TransactionPanel key={txn.id} txn={txn} />
          </td>
        </tr>
      )}
    </>
  );
}
