import { useState } from 'react';
import type { ColumnMapping } from '../lib/imports';
import { input, label } from './ui';

type Draft = Partial<ColumnMapping> &
  Pick<ColumnMapping, 'headerRowIndex' | 'amountSign' | 'dateFormat'>;
type HeaderField = Exclude<keyof ColumnMapping, 'headerRowIndex' | 'amountSign' | 'dateFormat'>;

const fields: { key: HeaderField; label: string; required?: boolean }[] = [
  { key: 'date', label: 'תאריך', required: true },
  { key: 'description', label: 'תיאור', required: true },
  { key: 'amount', label: 'סכום (עמודה אחת)' },
  { key: 'debit', label: 'חובה' },
  { key: 'credit', label: 'זכות' },
  { key: 'processedDate', label: 'תאריך חיוב' },
  { key: 'memo', label: 'הערה' },
  { key: 'identifier', label: 'אסמכתא' },
  { key: 'originalAmount', label: 'סכום מקורי' },
  { key: 'originalCurrency', label: 'מטבע מקורי' },
  { key: 'balance', label: 'יתרה' },
];

/** Drops empty/undefined header picks so the body satisfies ColumnMapping (exact optional keys). */
function toMapping(d: Draft): ColumnMapping | null {
  if (!d.date || !d.description) return null;
  const out: ColumnMapping = {
    headerRowIndex: d.headerRowIndex,
    date: d.date,
    description: d.description,
    amountSign: d.amountSign,
    dateFormat: d.dateFormat,
  };
  for (const f of fields) {
    if (f.key === 'date' || f.key === 'description') continue;
    const v = d[f.key];
    if (v) out[f.key] = v;
  }
  return out;
}

export function MappingEditor({
  headers,
  mapping,
  headerRowIndex,
  onChange,
  disabled,
}: {
  headers: string[];
  mapping: ColumnMapping | null;
  headerRowIndex: number;
  onChange: (m: ColumnMapping) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(
    mapping ?? { headerRowIndex, amountSign: 'natural', dateFormat: 'auto' },
  );

  const patch = (p: Partial<Draft>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    const m = toMapping(next);
    if (m) onChange(m);
  };

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
      <label className={label}>
        שורת כותרות (0 = ראשונה)
        <input
          className={`${input} num`}
          type="number"
          min={0}
          value={draft.headerRowIndex}
          disabled={disabled}
          onChange={(e) => {
            patch({ headerRowIndex: Math.max(0, Number(e.target.value)) });
          }}
        />
      </label>
      {fields.map((f) => (
        <label key={f.key} className={label}>
          {f.label}
          {f.required && ' *'}
          <select
            className={input}
            value={draft[f.key] ?? ''}
            disabled={disabled}
            onChange={(e) => {
              patch({ [f.key]: e.target.value || undefined });
            }}
          >
            <option value="">—</option>
            {headers.map((h, i) => (
              <option key={`${h}-${i}`} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className={label}>
        סימן הסכום
        <select
          className={input}
          value={draft.amountSign}
          disabled={disabled}
          onChange={(e) => {
            patch({ amountSign: e.target.value as ColumnMapping['amountSign'] });
          }}
        >
          <option value="natural">שלילי = הוצאה</option>
          <option value="invert">חיובי = הוצאה (הפוך)</option>
        </select>
      </label>
      <label className={label}>
        פורמט תאריך
        <select
          className={input}
          value={draft.dateFormat}
          disabled={disabled}
          onChange={(e) => {
            patch({ dateFormat: e.target.value as ColumnMapping['dateFormat'] });
          }}
        >
          <option value="auto">אוטומטי</option>
          <option value="DMY">יום/חודש/שנה</option>
          <option value="MDY">חודש/יום/שנה</option>
          <option value="YMD">שנה-חודש-יום</option>
        </select>
      </label>
    </div>
  );
}
