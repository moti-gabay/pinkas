import type { TransactionDto } from '@pinkas/shared';
import { useState } from 'react';
import { useUpdateTransaction } from '../lib/queries';
import { ErrorNote } from './ErrorNote';
import { btn, btnPrimary, input, label } from './ui';

/** Expanded row: notes, tags and exclude/undo. */
export function TransactionPanel({ txn }: { txn: TransactionDto }) {
  const update = useUpdateTransaction();
  const [notes, setNotes] = useState(txn.notes ?? '');
  const [tags, setTags] = useState(txn.tags.join(', '));
  const excluded = txn.excludeReason !== null;

  const save = () => {
    update.mutate({
      id: txn.id,
      notes: notes.trim() === '' ? null : notes.trim(),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 bg-gray-50 p-3 text-sm dark:bg-gray-800/50">
      <label className={`${label} grow`}>
        הערות
        <input
          className={input}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
          maxLength={1000}
        />
      </label>
      <label className={`${label} grow`}>
        תגיות (מופרדות בפסיק)
        <input
          className={input}
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
          }}
        />
      </label>
      <button type="button" className={btnPrimary} onClick={save} disabled={update.isPending}>
        שמור
      </button>
      {txn.excludeReason === null || txn.excludeReason === 'user' ? (
        <button
          type="button"
          className={btn}
          disabled={update.isPending}
          onClick={() => {
            update.mutate({ id: txn.id, excludeReason: excluded ? null : 'user' });
          }}
        >
          {excluded ? 'החזר לתזרים' : 'החרג מהתזרים'}
        </button>
      ) : (
        <span className="text-gray-500">מוחרג אוטומטית ({txn.excludeReason})</span>
      )}
      {txn.memo && <span className="basis-full text-gray-500">הערת מקור: {txn.memo}</span>}
      <ErrorNote error={update.error} className="basis-full" />
    </div>
  );
}
