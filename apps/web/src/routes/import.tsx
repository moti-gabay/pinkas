import { PinkasError, formatAgorot, formatDate } from '@pinkas/shared';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { MappingEditor } from '../components/MappingEditor';
import { MoneyAmount } from '../components/MoneyAmount';
import { Spinner } from '../components/Spinner';
import { badge, btn, btnDanger, btnPrimary, card, input, label, td, th } from '../components/ui';
import {
  MAX_UPLOAD_BYTES,
  useCancelImport,
  useConfirmImport,
  useImportPreview,
  useImports,
  useUpdateMapping,
  useUploadImport,
  type ConfirmResult,
  type ImportPreview,
  type RowDecision,
} from '../lib/imports';
import { formatDateTime } from '../lib/month';
import { useAccounts } from '../lib/queries';

export const Route = createFileRoute('/import')({
  validateSearch: z.object({ importId: z.string().optional() }),
  component: ImportPage,
});

const decisionHe: Record<RowDecision, { text: string; cls: string }> = {
  insert: { text: 'חדש', cls: 'bg-green-100 text-green-800' },
  duplicate: { text: 'כפול', cls: 'bg-gray-200 dark:bg-gray-700' },
  update_pending: { text: 'עדכון', cls: 'bg-blue-100 text-blue-800' },
  update_status: { text: 'עדכון', cls: 'bg-blue-100 text-blue-800' },
  error: { text: 'שגיאה', cls: 'bg-red-100 text-red-800' },
};
const statusHe: Record<string, string> = {
  pending: 'ממתין',
  previewed: 'בתצוגה מקדימה',
  committed: 'הושלם',
  cancelled: 'בוטל',
};

function ImportPage() {
  const { importId } = Route.useSearch();
  const navigate = useNavigate();
  const reset = () => void navigate({ to: '/import', search: {} });
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">ייבוא קובץ</h1>
      {importId ? (
        <PreviewStep importId={importId} onDone={reset} />
      ) : (
        <UploadStep
          onUploaded={(id) => void navigate({ to: '/import', search: { importId: id } })}
        />
      )}
      <PastImports />
    </div>
  );
}

function UploadStep({ onUploaded }: { onUploaded: (importId: string) => void }) {
  const accounts = useAccounts();
  const upload = useUploadImport();
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sizeError, setSizeError] = useState(false);

  const pick = (f: File | null) => {
    setSizeError(f !== null && f.size > MAX_UPLOAD_BYTES);
    setFile(f);
  };
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!file || !accountId || sizeError) return;
    upload.mutate(
      { file, accountId },
      {
        onSuccess: (r) => {
          onUploaded(r.importId);
        },
      },
    );
  };

  if (accounts.isPending) return <Spinner />;
  if (accounts.data?.length === 0) {
    return (
      <EmptyState title="אין חשבונות עדיין">
        <Link to="/accounts" className="underline">
          צור מקור קבצים בעמוד החשבונות
        </Link>
      </EmptyState>
    );
  }
  return (
    <form onSubmit={submit} className={`${card} flex flex-col gap-3`}>
      <h2 className="font-semibold">שלב 1: בחר חשבון וקובץ</h2>
      <label className={label}>
        חשבון
        <select
          className={input}
          required
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
          }}
        >
          <option value="">בחר…</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} {a.maskedLabel}
            </option>
          ))}
        </select>
      </label>
      <label
        className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files[0] ?? null);
        }}
      >
        {file ? (
          <span className="text-gray-900 dark:text-gray-100">{file.name}</span>
        ) : (
          'גרור לכאן קובץ CSV / XLSX או לחץ לבחירה'
        )}
        <span className="text-xs">עד 15MB</span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0] ?? null);
          }}
        />
      </label>
      {sizeError && <p className="text-sm text-red-700">הקובץ גדול מ-15MB</p>}
      <ErrorNote error={accounts.error ?? upload.error} />
      <div>
        <button
          type="submit"
          className={btnPrimary}
          disabled={!file || !accountId || sizeError || upload.isPending}
        >
          {upload.isPending ? 'מעלה…' : 'העלה'}
        </button>
      </div>
    </form>
  );
}

function PreviewStep({ importId, onDone }: { importId: string; onDone: () => void }) {
  const [tableIndex, setTableIndex] = useState<number | undefined>(undefined);
  const preview = useImportPreview(importId, tableIndex);
  const updateMapping = useUpdateMapping(importId, tableIndex);
  const confirm = useConfirmImport(importId);
  const cancel = useCancelImport();
  const [ack, setAck] = useState(false);
  const [done, setDone] = useState<{ result: ConfirmResult; from: string; to: string } | null>(
    null,
  );

  const mismatch =
    confirm.error instanceof PinkasError && confirm.error.code === 'IMPORT_NOT_RECONCILED'
      ? confirm.error.details
      : undefined;

  const runConfirm = (p: ImportPreview) => {
    const dates = (p.parsed?.rows ?? []).map((r) => r.txnDate).sort();
    const from = dates[0] ?? '';
    const to = dates[dates.length - 1] ?? '';
    confirm.mutate(ack, {
      onSuccess: (result) => {
        setDone({ result, from, to });
      },
    });
  };

  if (done) {
    return (
      <div className={`${card} flex flex-col gap-2`}>
        <h2 className="font-semibold">הייבוא הושלם</h2>
        <p className="text-sm">
          נוספו <b className="num">{done.result.rowsAdded}</b> · עודכנו{' '}
          <b className="num">{done.result.rowsUpdated}</b> · דולגו{' '}
          <b className="num">{done.result.rowsSkipped}</b> · התאמה:{' '}
          <Reconciled value={done.result.reconciled} />
        </p>
        <div className="flex gap-3">
          {done.from && (
            <Link
              to="/transactions"
              search={{ from: done.from, to: done.to }}
              className={btnPrimary}
            >
              לתנועות שיובאו
            </Link>
          )}
          <button type="button" className={btn} onClick={onDone}>
            ייבוא נוסף
          </button>
        </div>
      </div>
    );
  }

  if (preview.isPending) return <Spinner />;
  if (preview.isError) {
    return (
      <div className={card}>
        <ErrorNote error={preview.error} />
        <button type="button" className={`${btn} mt-2`} onClick={onDone}>
          חזרה
        </button>
      </div>
    );
  }
  const p = preview.data;
  const parsed = p.parsed;

  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} flex flex-col gap-3`}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">שלב 2: מיפוי עמודות</h2>
          {p.tables.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              גיליון
              <select
                className={input}
                value={p.tableIndex}
                onChange={(e) => {
                  setTableIndex(Number(e.target.value));
                }}
              >
                {p.tables.map((t) => (
                  <option key={t.index} value={t.index}>
                    {t.name} ({t.rowCount} שורות)
                  </option>
                ))}
              </select>
            </label>
          )}
          {updateMapping.isPending && <span className="text-xs text-gray-500">מעדכן…</span>}
          <button
            type="button"
            className={`${btnDanger} ms-auto`}
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate(importId, { onSuccess: onDone });
            }}
          >
            בטל ייבוא
          </button>
        </div>
        <MappingEditor
          key={p.tableIndex}
          headers={p.headers}
          mapping={p.mapping}
          headerRowIndex={p.headerRowIndex}
          disabled={updateMapping.isPending}
          onChange={(mapping) => {
            updateMapping.mutate({ mapping, tableIndex: p.tableIndex });
          }}
        />
        <ErrorNote error={updateMapping.error ?? cancel.error} />
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500">שורות לדוגמה מהקובץ</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className={th}>#</th>
                  {p.headers.map((h, i) => (
                    <th key={`${h}-${i}`} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.sampleRows.map((r) => (
                  <tr key={r.rowIndex} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={`${td} num text-gray-400`}>{r.rowIndex}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className={`${td} whitespace-nowrap`}>
                        {c === null ? '' : String(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {parsed ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`${card} text-sm`}>
              <h3 className="mb-2 font-semibold">סיכום שורות</h3>
              <div className="flex flex-wrap gap-2">
                <span className={`${badge} ${decisionHe.insert.cls}`}>
                  חדש: {parsed.counts.insert}
                </span>
                <span className={`${badge} ${decisionHe.duplicate.cls}`}>
                  כפול: {parsed.counts.duplicate}
                </span>
                <span className={`${badge} ${decisionHe.update_pending.cls}`}>
                  עדכון: {parsed.counts.update}
                </span>
                <span className={`${badge} ${decisionHe.error.cls}`}>
                  שגיאה: {parsed.counts.error}
                </span>
              </div>
              {parsed.hashKindDowngrade && (
                <p className="mt-2 text-amber-700">
                  לקובץ זה אין אסמכתאות; זיהוי הכפילויות למקור יעבור להשוואת שדות.
                </p>
              )}
            </div>
            <div className={`${card} text-sm`}>
              <h3 className="mb-2 font-semibold">התאמת סכומים</h3>
              <p>
                סכום השורות: <MoneyAmount agorot={parsed.computedTotalAgorot} />
              </p>
              <p>
                סיכום בדף:{' '}
                {parsed.statementTotalAgorot === null ? (
                  '—'
                ) : (
                  <MoneyAmount agorot={parsed.statementTotalAgorot} />
                )}
              </p>
              <p>
                התאמה: <Reconciled value={parsed.reconciled} />
              </p>
            </div>
          </div>

          <ParsedRows parsed={parsed} />

          <div className={`${card} flex flex-col gap-3`}>
            <h2 className="font-semibold">שלב 3: אישור</h2>
            {mismatch && (
              <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <p>
                  סכום השורות ({formatAgorot(numberOr0(mismatch['computedTotalAgorot']))}) אינו תואם
                  לסיכום הדף ({formatAgorot(numberOr0(mismatch['statementTotalAgorot']))}).
                </p>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => {
                      setAck(e.target.checked);
                    }}
                  />
                  אני מאשר למרות אי-ההתאמה
                </label>
              </div>
            )}
            {!mismatch && <ErrorNote error={confirm.error} />}
            <div>
              <button
                type="button"
                className={btnPrimary}
                disabled={
                  confirm.isPending || updateMapping.isPending || (mismatch !== undefined && !ack)
                }
                onClick={() => {
                  runConfirm(p);
                }}
              >
                {confirm.isPending
                  ? 'מייבא…'
                  : `אשר וייבא ${parsed.counts.insert + parsed.counts.update} שורות`}
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500">
          בחר לפחות עמודת תאריך ועמודת תיאור כדי לראות תצוגה מקדימה.
        </p>
      )}
    </div>
  );
}

function numberOr0(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function Reconciled({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  return value ? (
    <span className="text-(--color-income)">✓</span>
  ) : (
    <span className="text-(--color-expense)">✗</span>
  );
}

function ParsedRows({ parsed }: { parsed: NonNullable<ImportPreview['parsed']> }) {
  const errors = useMemo(
    () => new Map(parsed.errors.map((e) => [e.rowIndex, e.message])),
    [parsed.errors],
  );
  return (
    <div className={`${card} max-h-96 overflow-auto p-0`}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white dark:bg-gray-900">
          <tr>
            <th className={th}>#</th>
            <th className={th}>תאריך</th>
            <th className={th}>תיאור</th>
            <th className={th}>סכום</th>
            <th className={th}>החלטה</th>
          </tr>
        </thead>
        <tbody>
          {parsed.rows.map((r) => (
            <tr key={r.rowIndex} className="border-t border-gray-100 dark:border-gray-800">
              <td className={`${td} num text-gray-400`}>{r.rowIndex}</td>
              <td className={`${td} num`}>{formatDate(r.txnDate)}</td>
              <td className={td}>{r.descriptionRaw}</td>
              <td className={td}>
                <MoneyAmount agorot={r.chargedAmountAgorot} />
              </td>
              <td className={td}>
                <span className={`${badge} ${decisionHe[r.decision].cls}`}>
                  {decisionHe[r.decision].text}
                </span>
                {r.error && <span className="ms-2 text-xs text-red-700">{r.error}</span>}
                {!r.error && errors.get(r.rowIndex) && (
                  <span className="ms-2 text-xs text-red-700">{errors.get(r.rowIndex)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PastImports() {
  const imports = useImports();
  const accounts = useAccounts();
  const names = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.displayName])),
    [accounts.data],
  );
  if (imports.isPending) return <Spinner />;
  if (imports.isError) return <ErrorNote error={imports.error} />;
  if (imports.data.length === 0) return null;
  return (
    <div className={`${card} overflow-x-auto`}>
      <h2 className="mb-2 font-semibold">ייבואים קודמים</h2>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={th}>קובץ</th>
            <th className={th}>חשבון</th>
            <th className={th}>סטטוס</th>
            <th className={th}>נוספו</th>
            <th className={th}>דולגו</th>
            <th className={th}>התאמה</th>
            <th className={th}>תאריך</th>
          </tr>
        </thead>
        <tbody>
          {imports.data.map((i) => (
            <tr key={i.id} className="border-t border-gray-100 dark:border-gray-800">
              <td className={td}>
                {i.status === 'committed' || i.status === 'cancelled' ? (
                  i.fileName
                ) : (
                  <Link to="/import" search={{ importId: i.id }} className="underline">
                    {i.fileName}
                  </Link>
                )}
              </td>
              <td className={td}>{names.get(i.accountId) ?? '?'}</td>
              <td className={td}>{statusHe[i.status] ?? i.status}</td>
              <td className={`${td} num`}>{i.rowsAdded}</td>
              <td className={`${td} num`}>{i.rowsSkipped}</td>
              <td className={td}>
                <Reconciled value={i.reconciled} />
              </td>
              <td className={`${td} num`}>{formatDateTime(i.committedAt ?? i.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
