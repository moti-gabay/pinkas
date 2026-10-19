import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorNote } from '../components/ErrorNote';
import { Spinner } from '../components/Spinner';
import { badge, card, input, label, td, th } from '../components/ui';
import { formatDateTime } from '../lib/month';
import { useSources, useSyncRuns } from '../lib/queries';
import {
  formatDuration,
  runStatusClass,
  runStatusHe,
  syncErrorMessageHe,
  triggerHe,
} from '../lib/sync';

export const Route = createFileRoute('/sync')({ component: SyncPage });

function SyncPage() {
  const [sourceId, setSourceId] = useState('');
  const sources = useSources();
  const runs = useSyncRuns({ sourceId: sourceId || undefined, limit: 100 });
  const sourceName = useMemo(
    () => new Map((sources.data ?? []).map((s) => [s.id, s.displayName])),
    [sources.data],
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">היסטוריית סנכרון</h1>
      <div className="flex">
        <label className={label}>
          מקור
          <select
            className={input}
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
            }}
          >
            <option value="">כל המקורות</option>
            {sources.data
              ?.filter((s) => s.kind === 'scraper')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
          </select>
        </label>
      </div>
      {runs.isPending && <Spinner />}
      <ErrorNote error={runs.error ?? sources.error} />
      {runs.data?.length === 0 && <EmptyState title="אין עדיין ריצות סנכרון" />}
      {runs.data && runs.data.length > 0 && (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>מקור</th>
                <th className={th}>הפעלה</th>
                <th className={th}>התחלה</th>
                <th className={th}>משך</th>
                <th className={th}>סטטוס</th>
                <th className={th}>נוספו</th>
                <th className={th}>עודכנו</th>
                <th className={th}>קושרו</th>
                <th className={th}>שגיאה</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className={`${td} font-medium`}>{sourceName.get(r.sourceId) ?? '?'}</td>
                  <td className={td}>{triggerHe[r.trigger]}</td>
                  <td className={`${td} num`}>{formatDateTime(r.startedAt)}</td>
                  <td className={`${td} num`}>{formatDuration(r.durationMs)}</td>
                  <td className={td}>
                    <span className={`${badge} ${runStatusClass[r.status]}`}>
                      {runStatusHe[r.status]}
                    </span>
                  </td>
                  <td className={`${td} num`}>{r.rowsAdded}</td>
                  <td className={`${td} num`}>{r.rowsUpdated}</td>
                  <td className={`${td} num`}>{r.rowsLinked}</td>
                  <td className={`${td} text-red-700 dark:text-red-400`}>
                    {syncErrorMessageHe(r.errorType)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
