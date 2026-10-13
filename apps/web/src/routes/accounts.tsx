import type { AccountDto, SourceDto } from '@pinkas/shared';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type SyntheticEvent } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { MoneyAmount } from '../components/MoneyAmount';
import { Spinner } from '../components/Spinner';
import { badge, btnDanger, btnPrimary, card, input, label } from '../components/ui';
import { formatDateTime } from '../lib/month';
import { useAccounts, useCreateFileSource, useDeleteSource, useSources } from '../lib/queries';

export const Route = createFileRoute('/accounts')({ component: AccountsPage });

export const accountTypeHe: Record<AccountDto['type'], string> = {
  checking: 'עו"ש',
  credit_card: 'כרטיס אשראי',
  savings: 'חיסכון',
};

function AccountsPage() {
  const sources = useSources();
  const accounts = useAccounts();
  const del = useDeleteSource();

  const remove = (s: SourceDto) => {
    if (window.confirm(`למחוק את המקור «${s.displayName}» על כל התנועות שלו?`)) del.mutate(s.id);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">חשבונות</h1>
      {(sources.isPending || accounts.isPending) && <Spinner />}
      <ErrorNote error={sources.error ?? accounts.error ?? del.error} />
      {sources.data && accounts.data && sources.data.length === 0 && (
        <EmptyState title="אין מקורות עדיין — הוסף מקור קבצים כדי להתחיל" />
      )}
      {sources.data?.map((s) => (
        <div key={s.id} className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{s.displayName}</span>
            <span className={`${badge} bg-gray-100 dark:bg-gray-800`}>
              {s.kind === 'file' ? 'קבצים' : 'סנכרון אוטומטי'}
            </span>
            {s.kind === 'scraper' && (
              <span className={`${badge} bg-amber-100 text-amber-800`}>בשלב 2</span>
            )}
            {!s.enabled && <span className={`${badge} bg-red-100 text-red-800`}>מושבת</span>}
            <span className="ms-auto text-xs text-gray-500">
              {s.lastSuccessAt && <>הצלחה אחרונה: {formatDateTime(s.lastSuccessAt)}</>}
              {s.lastErrorAt && (
                <span className="ms-3 text-red-700">
                  שגיאה: {s.lastErrorType} ({formatDateTime(s.lastErrorAt)})
                </span>
              )}
            </span>
            <button
              type="button"
              className={btnDanger}
              onClick={() => {
                remove(s);
              }}
              disabled={del.isPending}
            >
              מחק
            </button>
          </div>
          <ul className="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {accounts.data
              ?.filter((a) => a.sourceId === s.id)
              .map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span>{a.displayName}</span>
                  <span className="num text-gray-500">{a.maskedLabel}</span>
                  <span className={`${badge} bg-gray-100 dark:bg-gray-800`}>
                    {accountTypeHe[a.type]}
                  </span>
                  {!a.isActive && (
                    <span className={`${badge} bg-gray-200 dark:bg-gray-700`}>לא פעיל</span>
                  )}
                  {a.cardCycleDay !== null && (
                    <span className="text-xs text-gray-500">יום חיוב: {a.cardCycleDay}</span>
                  )}
                  {a.balanceAgorot !== null && (
                    <span className="ms-auto">
                      יתרה: <MoneyAmount agorot={a.balanceAgorot} />
                      {a.balanceAt && (
                        <span className="ms-1 text-xs text-gray-500">
                          ({formatDateTime(a.balanceAt)})
                        </span>
                      )}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
      <NewFileSourceForm />
    </div>
  );
}

function NewFileSourceForm() {
  const create = useCreateFileSource();
  const [displayName, setDisplayName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [type, setType] = useState<AccountDto['type']>('checking');
  const [externalId, setExternalId] = useState('');
  const [cycleDay, setCycleDay] = useState('');

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const day = Number(cycleDay);
    create.mutate(
      {
        displayName,
        account: {
          displayName: accountName,
          type,
          externalId,
          ...(type === 'credit_card' && day >= 1 && day <= 31 ? { cardCycleDay: day } : {}),
        },
      },
      {
        onSuccess: () => {
          setDisplayName('');
          setAccountName('');
          setExternalId('');
          setCycleDay('');
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className={`${card} flex flex-col gap-3`}>
      <h2 className="font-semibold">הוסף מקור קבצים</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          שם המקור (למשל «בנק לאומי – קבצים»)
          <input
            className={input}
            required
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
          />
        </label>
        <label className={label}>
          שם החשבון
          <input
            className={input}
            required
            value={accountName}
            onChange={(e) => {
              setAccountName(e.target.value);
            }}
          />
        </label>
        <label className={label}>
          סוג חשבון
          <select
            className={input}
            value={type}
            onChange={(e) => {
              setType(e.target.value as AccountDto['type']);
            }}
          >
            {(Object.keys(accountTypeHe) as AccountDto['type'][]).map((t) => (
              <option key={t} value={t}>
                {accountTypeHe[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          מספר חשבון / כרטיס
          <input
            className={`${input} num`}
            required
            value={externalId}
            onChange={(e) => {
              setExternalId(e.target.value);
            }}
          />
          <span className="text-xs text-gray-500">
            נשמר לזיהוי בלבד; באפליקציה יוצגו רק 4 הספרות האחרונות.
          </span>
        </label>
        {type === 'credit_card' && (
          <label className={label}>
            יום חיוב חודשי (1–31, לא חובה)
            <input
              className={`${input} num`}
              type="number"
              min={1}
              max={31}
              value={cycleDay}
              onChange={(e) => {
                setCycleDay(e.target.value);
              }}
            />
          </label>
        )}
      </div>
      <ErrorNote error={create.error} />
      <div>
        <button type="submit" className={btnPrimary} disabled={create.isPending}>
          הוסף
        </button>
      </div>
    </form>
  );
}
