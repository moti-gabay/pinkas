import type { CategoryDto, RuleDto } from '@pinkas/shared';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState, type SyntheticEvent } from 'react';
import { CategorySelect } from '../components/CategorySelect';
import { ErrorNote } from '../components/ErrorNote';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { badge, btn, btnDanger, btnPrimary, card, input, label, td, th } from '../components/ui';
import {
  useCategories,
  useCreateRule,
  useDeleteRule,
  useLogout,
  useReapplyRules,
  useRules,
  useUpdateRule,
} from '../lib/queries';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

const matchHe: Record<RuleDto['match'], string> = {
  contains: 'מכיל',
  exact: 'זהה',
  prefix: 'מתחיל ב',
  regex: 'ביטוי רגולרי',
};
const fieldHe: Record<RuleDto['field'], string> = {
  merchant_normalized: 'בית עסק',
  description_raw: 'תיאור מקורי',
};
const originHe: Record<RuleDto['origin'], string> = {
  seed: 'מובנה',
  user: 'ידני',
  learned: 'נלמד',
};

function SettingsPage() {
  const rules = useRules();
  const categories = useCategories();
  const del = useDeleteRule();
  const update = useUpdateRule();
  const reapply = useReapplyRules();
  const logout = useLogout();
  const toast = useToast();
  const catName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.nameHe])),
    [categories.data],
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">הגדרות</h1>

      <section className={card}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-semibold">חוקי סיווג</h2>
          <button
            type="button"
            className={`${btn} ms-auto`}
            disabled={reapply.isPending}
            onClick={() => {
              reapply.mutate(undefined, {
                onSuccess: (r) => {
                  toast({ message: `סווגו מחדש ${r.recategorized} תנועות` });
                },
              });
            }}
          >
            הפעל חוקים מחדש
          </button>
        </div>
        {(rules.isPending || categories.isPending) && <Spinner />}
        <ErrorNote error={rules.error ?? del.error ?? update.error ?? reapply.error} />
        {rules.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>תבנית</th>
                  <th className={th}>התאמה</th>
                  <th className={th}>שדה</th>
                  <th className={th}>קטגוריה</th>
                  <th className={th}>קבוע</th>
                  <th className={th}>עדיפות</th>
                  <th className={th}>מקור</th>
                  <th className={th}>פגיעות</th>
                  <th className={th}>פעיל</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {rules.data.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className={`${td} font-medium`}>{r.pattern}</td>
                    <td className={td}>{matchHe[r.match]}</td>
                    <td className={td}>{fieldHe[r.field]}</td>
                    <td className={td}>{catName.get(r.categoryId) ?? '?'}</td>
                    <td className={td}>{r.isFixed === null ? '—' : r.isFixed ? 'כן' : 'לא'}</td>
                    <td className={`${td} num`}>{r.priority}</td>
                    <td className={td}>
                      <span className={`${badge} bg-gray-100 dark:bg-gray-800`}>
                        {originHe[r.origin]}
                      </span>
                    </td>
                    <td className={`${td} num`}>{r.hitCount}</td>
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={update.isPending}
                        onChange={(e) => {
                          update.mutate({ id: r.id, enabled: e.target.checked });
                        }}
                        aria-label="פעיל"
                      />
                    </td>
                    <td className={td}>
                      <button
                        type="button"
                        className={btnDanger}
                        disabled={del.isPending}
                        onClick={() => {
                          if (window.confirm(`למחוק את החוק «${r.pattern}»?`)) del.mutate(r.id);
                        }}
                      >
                        מחק
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rules.data.length === 0 && <p className="p-3 text-gray-500">אין חוקים עדיין</p>}
          </div>
        )}
        {categories.data && <NewRuleForm categories={categories.data} />}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">קטגוריות</h2>
        {categories.data && <CategoryTree categories={categories.data} />}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">חשבון</h2>
        <button
          type="button"
          className={btn}
          onClick={() => {
            logout.mutate();
          }}
          disabled={logout.isPending}
        >
          יציאה
        </button>
      </section>

      <section className={`${card} text-gray-500`}>
        <h2 className="font-semibold">מחיקת כל הנתונים</h2>
        <p className="text-sm">בקרוב</p>
      </section>
    </div>
  );
}

function NewRuleForm({ categories }: { categories: CategoryDto[] }) {
  const create = useCreateRule();
  const toast = useToast();
  const [pattern, setPattern] = useState('');
  const [match, setMatch] = useState<RuleDto['match']>('contains');
  const [field, setField] = useState<RuleDto['field']>('merchant_normalized');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [fixed, setFixed] = useState<'default' | 'yes' | 'no'>('default');
  const [priority, setPriority] = useState('100');

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!categoryId) return;
    create.mutate(
      {
        pattern,
        match,
        field,
        categoryId,
        isFixed: fixed === 'default' ? null : fixed === 'yes',
        priority: Number(priority),
        origin: 'user',
        applyToExisting: true,
      },
      {
        onSuccess: (r) => {
          toast({ message: `החוק נשמר; סווגו מחדש ${r.recategorized} תנועות` });
          setPattern('');
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800"
    >
      <label className={label}>
        תבנית
        <input
          className={input}
          required
          value={pattern}
          onChange={(e) => {
            setPattern(e.target.value);
          }}
        />
      </label>
      <label className={label}>
        התאמה
        <select
          className={input}
          value={match}
          onChange={(e) => {
            setMatch(e.target.value as RuleDto['match']);
          }}
        >
          {(Object.keys(matchHe) as RuleDto['match'][]).map((m) => (
            <option key={m} value={m}>
              {matchHe[m]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        שדה
        <select
          className={input}
          value={field}
          onChange={(e) => {
            setField(e.target.value as RuleDto['field']);
          }}
        >
          {(Object.keys(fieldHe) as RuleDto['field'][]).map((f) => (
            <option key={f} value={f}>
              {fieldHe[f]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        קטגוריה
        <CategorySelect
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
          placeholder="בחר…"
        />
      </label>
      <label className={label}>
        קבוע
        <select
          className={input}
          value={fixed}
          onChange={(e) => {
            setFixed(e.target.value as 'default' | 'yes' | 'no');
          }}
        >
          <option value="default">ברירת מחדל</option>
          <option value="yes">כן</option>
          <option value="no">לא</option>
        </select>
      </label>
      <label className={label}>
        עדיפות
        <input
          className={`${input} num w-20`}
          type="number"
          min={0}
          max={1000}
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
          }}
        />
      </label>
      <button type="submit" className={btnPrimary} disabled={create.isPending || !categoryId}>
        הוסף חוק
      </button>
      <ErrorNote error={create.error} className="basis-full" />
    </form>
  );
}

function CategoryTree({ categories }: { categories: CategoryDto[] }) {
  const parents = categories.filter((c) => c.parentId === null).sort((a, b) => a.sort - b.sort);
  return (
    <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {parents.map((p) => (
        <li key={p.id}>
          <span className="font-medium">
            {p.icon} {p.nameHe}
          </span>
          <ul className="ms-5 text-gray-600 dark:text-gray-400">
            {categories
              .filter((c) => c.parentId === p.id)
              .sort((a, b) => a.sort - b.sort)
              .map((c) => (
                <li key={c.id}>{c.nameHe}</li>
              ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
