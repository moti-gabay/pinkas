import { formatDate, formatPercent } from '@pinkas/shared';
import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { MoneyAmount } from '../components/MoneyAmount';
import { Spinner } from '../components/Spinner';
import { badge, btn, btnDanger, card, td, th } from '../components/ui';
import { useConfirmTransfer, useReconciliation, useUnlinkTransfer } from '../lib/queries';
import type { ReconciliationLeg, SettlementDto, TransferLinkDto } from '../lib/reconciliation';

export const Route = createFileRoute('/reconciliation')({ component: ReconciliationPage });

function ReconciliationPage() {
  const rec = useReconciliation();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">התאמות</h1>
      {rec.isPending && <Spinner />}
      <ErrorNote error={rec.error} />
      {rec.data && (
        <>
          <Settlements rows={rec.data.settlements} />
          <Transfers rows={rec.data.transfers} />
          <StalePending rows={rec.data.stalePending} />
        </>
      )}
    </div>
  );
}

function Settlements({ rows }: { rows: SettlementDto[] }) {
  return (
    <section className={card}>
      <h2 className="font-semibold">חיובי כרטיס אשראי בבנק</h2>
      <p className="mb-3 text-sm text-gray-500">
        חיובים אלה אינם נספרים בהוצאות, כי הרכישות הבודדות בכרטיס כבר נספרות. כאן מוצגת ההתאמה בין
        החיוב בבנק לסך מחזור החיוב של הכרטיס.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="לא זוהו חיובי כרטיס" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>תאריך חיוב בבנק</th>
                <th className={th}>תיאור</th>
                <th className={th}>כרטיס</th>
                <th className={th}>מחזור</th>
                <th className={th}>חויב בפועל</th>
                <th className={th}>צפוי לפי הכרטיס</th>
                <th className={th}>הפרש</th>
                <th className={th}>סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className={`${td} num`}>{formatDate(s.bankTxnDate)}</td>
                  <td className={td}>{s.bankDescription}</td>
                  <td className={td}>{s.cardAccountLabel}</td>
                  <td className={`${td} num`}>{formatDate(s.cycleDate)}</td>
                  <td className={td}>
                    <MoneyAmount agorot={s.bankAmountAgorot} />
                  </td>
                  <td className={td}>
                    <MoneyAmount agorot={s.expectedTotalAgorot} />
                  </td>
                  <td
                    className={`${td} ${s.status === 'partial' ? 'bg-amber-100 font-semibold dark:bg-amber-950' : ''}`}
                  >
                    <MoneyAmount agorot={s.diffAgorot} />
                  </td>
                  <td className={td}>
                    {s.status === 'matched' ? (
                      <span className={`${badge} bg-green-100 text-green-800`}>תואם</span>
                    ) : (
                      <span className={`${badge} bg-amber-100 text-amber-800`}>התאמה חלקית</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Leg({ title, leg }: { title: string; leg: ReconciliationLeg }) {
  return (
    <div className="rounded border border-gray-200 p-3 dark:border-gray-800">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="font-medium">{leg.accountLabel}</div>
      <div>{leg.description}</div>
      <div className="flex items-center gap-3">
        <span className="num text-gray-500">{formatDate(leg.txnDate)}</span>
        <MoneyAmount agorot={leg.amountAgorot} className="ms-auto" />
      </div>
    </div>
  );
}

function Transfers({ rows }: { rows: TransferLinkDto[] }) {
  const confirm = useConfirmTransfer();
  const unlink = useUnlinkTransfer();
  const busy = confirm.isPending || unlink.isPending;
  return (
    <section className={card}>
      <h2 className="font-semibold">העברות בין החשבונות שלי</h2>
      <p className="mb-3 text-sm text-gray-500">
        זוגות תנועות שזוהו כהעברה בין שני חשבונות שלך, ולכן אינן נספרות כהכנסה או כהוצאה. ביטול
        קישור מחזיר את שתי התנועות לתזרים, והזוג לא יקושר שוב אוטומטית.
      </p>
      <ErrorNote error={confirm.error ?? unlink.error} className="mb-3" />
      {rows.length === 0 ? (
        <EmptyState title="לא זוהו העברות בין חשבונות" />
      ) : (
        <ul className="flex flex-col gap-4 text-sm">
          {rows.map((t) => (
            <li key={t.linkId} className="flex flex-col gap-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <Leg title="מחשבון" leg={t.from} />
                <Leg title="לחשבון" leg={t.to} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-gray-500">
                  ביטחון: <span className="num">{formatPercent(t.confidence)}</span>
                </span>
                {t.createdBy === 'user' ? (
                  <span className={`${badge} bg-green-100 text-green-800`}>אושר</span>
                ) : (
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    onClick={() => {
                      confirm.mutate(t.linkId);
                    }}
                  >
                    אשר
                  </button>
                )}
                <button
                  type="button"
                  className={btnDanger}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('לבטל את הקישור? הזוג לא יקושר שוב אוטומטית.'))
                      unlink.mutate(t.linkId);
                  }}
                >
                  בטל קישור
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StalePending({ rows }: { rows: ReconciliationLeg[] }) {
  return (
    <section className={card}>
      <h2 className="font-semibold">תנועות בהמתנה שלא נסגרו</h2>
      <p className="mb-3 text-sm text-gray-500">
        תנועות שנשארו במצב «בהמתנה» זמן רב ולא הופיעו שוב כתנועה סופית — ייתכן שבוטלו.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="אין תנועות תקועות בהמתנה" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>תאריך</th>
                <th className={th}>חשבון</th>
                <th className={th}>תיאור</th>
                <th className={th}>סכום</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.txnId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className={`${td} num`}>{formatDate(r.txnDate)}</td>
                  <td className={td}>{r.accountLabel}</td>
                  <td className={td}>{r.description}</td>
                  <td className={td}>
                    <MoneyAmount agorot={r.amountAgorot} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
