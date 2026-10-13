import { formatPercent, isoMonth } from '@pinkas/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';
import { CategoryDonut, colorAt } from '../components/CategoryDonut';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { MoneyAmount } from '../components/MoneyAmount';
import { MonthPicker } from '../components/MonthPicker';
import { Spinner } from '../components/Spinner';
import { card, td, th } from '../components/ui';
import { currentMonth, monthRange } from '../lib/month';
import { useCategories, useMonthReport } from '../lib/queries';
import { deltaPercent, rollupExpenses, type CategoryShare } from '../lib/report';

export const Route = createFileRoute('/')({
  validateSearch: z.object({ month: isoMonth.optional() }),
  component: Dashboard,
});

function Delta({
  current,
  previous,
  upIsGood,
}: {
  current: number;
  previous: number;
  upIsGood: boolean;
}) {
  const d = deltaPercent(current, previous);
  if (d === null) return <span className="text-gray-400">—</span>;
  const good = d === 0 ? null : d > 0 === upIsGood;
  const color =
    good === null ? 'text-gray-500' : good ? 'text-(--color-income)' : 'text-(--color-expense)';
  return (
    <span className={`num ${color}`}>{d > 0 ? `+${formatPercent(d)}` : formatPercent(d)}</span>
  );
}

function Dashboard() {
  const { month: monthParam } = Route.useSearch();
  const month = monthParam ?? currentMonth();
  const navigate = useNavigate();
  const report = useMonthReport(month);
  const categories = useCategories();
  const shares = useMemo(
    () => rollupExpenses(report.data?.byCategory ?? [], categories.data ?? []),
    [report.data, categories.data],
  );

  const { from, to } = monthRange(month);
  const goCategory = (c: CategoryShare) =>
    void navigate({
      to: '/transactions',
      search:
        c.categoryId === null
          ? { from, to, uncategorized: true }
          : { from, to, categoryId: c.categoryId },
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">סקירה חודשית</h1>
        <MonthPicker
          month={month}
          onChange={(m) => void navigate({ to: '/', search: { month: m } })}
        />
      </div>
      {report.isPending && <Spinner />}
      <ErrorNote error={report.error} />
      {report.data?.countedRows === 0 && (
        <EmptyState title="אין תנועות בחודש זה — ייבא קובץ או הוסף מקור" />
      )}
      {report.data && report.data.countedRows > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi title="הכנסות" agorot={report.data.incomeAgorot} />
            <Kpi title="הוצאות" agorot={-report.data.expensesAgorot} />
            <Kpi title="מאזן" agorot={report.data.netAgorot} />
          </div>

          <div className={`${card} text-sm`}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>לעומת</th>
                  <th className={th}>הכנסות</th>
                  <th className={th}>הוצאות</th>
                  <th className={th}>מאזן</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['חודש קודם', report.data.previous],
                    ['ממוצע 3 חודשים', report.data.avg3],
                    ['ממוצע 6 חודשים', report.data.avg6],
                  ] as const
                ).map(([label, base]) => (
                  <tr key={label} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={td}>{label}</td>
                    {base ? (
                      <>
                        <td className={td}>
                          <Delta
                            current={report.data.incomeAgorot}
                            previous={base.incomeAgorot}
                            upIsGood
                          />
                        </td>
                        <td className={td}>
                          <Delta
                            current={report.data.expensesAgorot}
                            previous={base.expensesAgorot}
                            upIsGood={false}
                          />
                        </td>
                        <td className={td}>
                          <Delta
                            current={report.data.netAgorot}
                            previous={base.netAgorot}
                            upIsGood
                          />
                        </td>
                      </>
                    ) : (
                      <td className={`${td} text-gray-400`} colSpan={3}>
                        אין נתונים
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <FixedVariableBar fixed={report.data.fixedAgorot} variable={report.data.variableAgorot} />

          <div className="grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h2 className="mb-2 font-semibold">הוצאות לפי קטגוריה</h2>
              {shares.length === 0 ? (
                <p className="text-sm text-gray-500">אין הוצאות בחודש זה</p>
              ) : (
                <CategoryDonut data={shares} onSelect={goCategory} />
              )}
            </div>
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>קטגוריה</th>
                    <th className={th}>סכום</th>
                    <th className={th}>תנועות</th>
                    <th className={th}>חלק</th>
                  </tr>
                </thead>
                <tbody>
                  {shares.map((c, i) => (
                    <tr
                      key={c.categoryId ?? 'none'}
                      className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                      onClick={() => {
                        goCategory(c);
                      }}
                    >
                      <td className={td}>
                        <span
                          className="me-2 inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: colorAt(i) }}
                        />
                        {c.nameHe}
                      </td>
                      <td className={td}>
                        <MoneyAmount agorot={-c.amountAgorot} whole />
                      </td>
                      <td className={`${td} num`}>{c.txnCount}</td>
                      <td className={`${td} num`}>{formatPercent(c.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ title, agorot }: { title: string; agorot: number }) {
  return (
    <div className={card}>
      <div className="text-sm text-gray-500">{title}</div>
      <MoneyAmount agorot={agorot} whole className="text-2xl font-bold" />
    </div>
  );
}

function FixedVariableBar({ fixed, variable }: { fixed: number; variable: number }) {
  const total = fixed + variable;
  const fixedPct = total === 0 ? 0 : fixed / total;
  return (
    <div className={card}>
      <div className="mb-2 flex justify-between text-sm">
        <span>
          קבועות: <MoneyAmount agorot={-fixed} whole /> ({formatPercent(fixedPct)})
        </span>
        <span>
          משתנות: <MoneyAmount agorot={-variable} whole /> ({formatPercent(1 - fixedPct)})
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
        <div className="bg-blue-600" style={{ width: `${fixedPct * 100}%` }} />
        <div className="bg-amber-500" style={{ width: `${(1 - fixedPct) * 100}%` }} />
      </div>
    </div>
  );
}
