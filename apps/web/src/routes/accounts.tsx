import {
  PinkasError,
  loginFieldLabelsHe,
  supportedCompanies,
  type AccountDto,
  type CompanyId,
  type LoginField,
  type SourceDto,
} from '@pinkas/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { MoneyAmount } from '../components/MoneyAmount';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { badge, btn, btnDanger, btnPrimary, card, input, label } from '../components/ui';
import { formatDateTime } from '../lib/month';
import {
  keys,
  useAccounts,
  useCreateFileSource,
  useCreateScraperSource,
  useDeleteSource,
  useLatestSyncRun,
  useSources,
  useSyncNow,
  useUpdateCredentials,
  useUpdateSource,
} from '../lib/queries';
import { isLoginClassError, isRunActive, syncErrorMessageHe } from '../lib/sync';

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
            {s.kind === 'scraper' && s.enabled && (
              <span className={`${badge} bg-green-100 text-green-800`}>פעיל</span>
            )}
            {!s.enabled && <span className={`${badge} bg-red-100 text-red-800`}>מושבת</span>}
            <span className="ms-auto text-xs text-gray-500">
              {s.lastSuccessAt && <>הצלחה אחרונה: {formatDateTime(s.lastSuccessAt)}</>}
              {s.lastErrorAt && (
                <span className="ms-3 text-red-700">
                  שגיאה: {syncErrorMessageHe(s.lastErrorType)} ({formatDateTime(s.lastErrorAt)})
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
          {s.kind === 'scraper' && <ScraperControls source={s} />}
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
      <NewScraperSourceForm />
      <NewFileSourceForm />
    </div>
  );
}

/** Sync now, enable/disable and credential re-entry for one scraper source. */
function ScraperControls({ source }: { source: SourceDto }) {
  const toast = useToast();
  const qc = useQueryClient();
  const latest = useLatestSyncRun(source.id);
  const sync = useSyncNow();
  const update = useUpdateSource();
  const [credsOpen, setCredsOpen] = useState(false);

  const run = latest.data?.[0];
  const active = isRunActive(run);
  // Never re-enable by toggle after a login-class failure: another attempt could lock the account.
  const locked = !source.enabled && isLoginClassError(source.lastErrorType);

  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active && run) {
      if (run.status === 'failed') {
        toast({ message: syncErrorMessageHe(run.errorType) ?? 'הסנכרון נכשל', kind: 'error' });
      } else {
        toast({
          message: `${run.status === 'partial' ? 'הסנכרון הושלם חלקית' : 'הסנכרון הושלם'}: ${run.rowsAdded} תנועות חדשות, ${run.rowsUpdated} עודכנו`,
        });
      }
      void qc.invalidateQueries({ queryKey: keys.sources });
      void qc.invalidateQueries({ queryKey: keys.accounts });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      void qc.invalidateQueries({ queryKey: ['report'] });
      void qc.invalidateQueries({ queryKey: keys.reconciliation });
    }
    wasActive.current = active;
  }, [active, run, toast, qc]);

  return (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      {locked && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          המקור הושבת בעקבות כשל בהתחברות. לא יבוצעו ניסיונות סנכרון נוספים עד שיוזנו מחדש פרטי
          ההתחברות — כדי למנוע נעילה של החשבון בבנק.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btnPrimary}
          disabled={!source.enabled || active || sync.isPending}
          onClick={() => {
            sync.mutate(source.id);
          }}
        >
          סנכרן עכשיו
        </button>
        {active && (
          <span className="flex items-center gap-2 text-gray-500" role="status">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
            {run?.status === 'queued' ? 'ממתין בתור…' : 'מסנכרן…'}
          </span>
        )}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={source.enabled}
            disabled={locked || update.isPending}
            onChange={(e) => {
              update.mutate({ id: source.id, enabled: e.target.checked });
            }}
          />
          פעיל
        </label>
        {source.enabled && (
          <button
            type="button"
            className={btn}
            onClick={() => {
              setCredsOpen((o) => !o);
            }}
          >
            עדכן פרטי התחברות
          </button>
        )}
      </div>
      <ErrorNote error={sync.error ?? update.error ?? latest.error} />
      {(credsOpen || !source.enabled) && (
        <CredentialsForm
          source={source}
          onDone={() => {
            setCredsOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CredentialFields({
  fields,
  values,
  onChange,
}: {
  fields: readonly LoginField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  return fields.map((f) => (
    <label key={f} className={label}>
      {loginFieldLabelsHe[f]}
      <input
        className={input}
        type="password"
        autoComplete="off"
        required
        maxLength={200}
        value={values[f] ?? ''}
        onChange={(e) => {
          onChange({ ...values, [f]: e.target.value });
        }}
      />
    </label>
  ));
}

/** Re-enter credentials (PUT). Highlighted while the source is disabled, since this re-enables it. */
function CredentialsForm({ source, onDone }: { source: SourceDto; onDone: () => void }) {
  const save = useUpdateCredentials();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  if (source.companyId === null) return null;

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    save.mutate(
      { id: source.id, credentials: values },
      {
        onSuccess: () => {
          toast({ message: 'פרטי ההתחברות עודכנו והמקור הופעל' });
          // Drop the submitted credentials from the mutation state.
          save.reset();
          onDone();
        },
      },
    );
    setValues({});
  };

  return (
    <form
      onSubmit={submit}
      autoComplete="off"
      className={`flex flex-wrap items-end gap-3 rounded border p-3 ${
        source.enabled
          ? 'border-gray-200 dark:border-gray-800'
          : 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950'
      }`}
    >
      <span className="basis-full font-medium">
        {source.enabled ? 'עדכון פרטי התחברות' : 'הזן מחדש פרטי התחברות כדי להפעיל את המקור'}
      </span>
      <CredentialFields
        fields={supportedCompanies[source.companyId].loginFields}
        values={values}
        onChange={setValues}
      />
      <button type="submit" className={btnPrimary} disabled={save.isPending}>
        שמור
      </button>
      <ErrorNote error={save.error} className="basis-full" />
    </form>
  );
}

function NewScraperSourceForm() {
  const create = useCreateScraperSource();
  const toast = useToast();
  const [companyId, setCompanyId] = useState<CompanyId>('leumi');
  const [displayName, setDisplayName] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const noPublicKey = create.error instanceof PinkasError && create.error.code === 'CONFLICT';

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    create.mutate(
      { companyId, displayName, credentials },
      {
        onSuccess: () => {
          toast({ message: 'המקור נוסף' });
          setDisplayName('');
          // Drop the submitted credentials from the mutation state.
          create.reset();
        },
      },
    );
    setCredentials({});
  };

  return (
    <form onSubmit={submit} autoComplete="off" className={`${card} flex flex-col gap-3`}>
      <h2 className="font-semibold">הוסף מקור אוטומטי</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          בנק / חברת אשראי
          <select
            className={input}
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value as CompanyId);
              setCredentials({});
            }}
          >
            {(Object.keys(supportedCompanies) as CompanyId[]).map((id) => (
              <option key={id} value={id}>
                {supportedCompanies[id].nameHe}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          שם המקור
          <input
            className={input}
            required
            maxLength={100}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
          />
        </label>
        <CredentialFields
          fields={supportedCompanies[companyId].loginFields}
          values={credentials}
          onChange={setCredentials}
        />
      </div>
      <p className="text-xs text-gray-500">
        הפרטים מוצפנים במפתח ציבורי ונפתחים רק בתהליך הסנכרון. הגישה לבנק היא לקריאה בלבד.
      </p>
      {noPublicKey ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          לא הוגדר בשרת מפתח ציבורי להצפנה, ולכן לא ניתן לשמור פרטי התחברות.
        </p>
      ) : (
        <ErrorNote error={create.error} />
      )}
      <div>
        <button type="submit" className={btnPrimary} disabled={create.isPending}>
          הוסף
        </button>
      </div>
    </form>
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
